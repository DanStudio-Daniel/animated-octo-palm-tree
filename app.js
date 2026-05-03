const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express();
app.use(bodyParser.json());

// 🌐 ROOT ROUTE
app.get('/', (req, res) => {
    res.send('<h1>Bot Running</h1>');
});

// ⚙️ CONFIGURATION
const PAGE_ACCESS_TOKEN = "EAAcLptP3AhgBRbxtMkjyqblLYuUryqvrNKX7bpydhj2hHG6IUTUg4o3TNye8O4O49F0ZAxkUl6DNtxhY3ZCv8pBQy8lmCL53TccXSQZC8lmqgpfFZARYDkcO4otxmz3Kp9LlKlG75i1JZAkry2vhGYYzX5OrEcq94LXdc0JKrV72KzFSZCuMD6wirwOnMFfGfVs6tr7QZDZD";
const VERIFY_TOKEN = "key";
const PORT = process.env.PORT || 10000;
const mongoURI = "mongodb+srv://danielmojar84_db_user:nDG9hpTU0uHZtxYO@cluster0.wsk0egt.mongodb.net/?appName=Cluster0";

// ==========================
// 🗄️ DATABASE MODELS
// ==========================
mongoose.connect(mongoURI).then(() => console.log("✅ MongoDB Connected Successfully"));

const userSchema = new mongoose.Schema({
    psid: { type: String, required: true, unique: true },
    name: { type: String },
    role: { type: String, default: "member" },
    isBanned: { type: Boolean, default: false },
    partnerId: { type: String, default: null },
    isWaiting: { type: Boolean, default: false },
    msgCount: { type: Number, default: 0 },
    regStep: { type: Number, default: 0 } 
});

const User = mongoose.model("User", userSchema);

// ==========================
// 🛠️ UTILITIES
// ==========================
const toBold = (text) => {
    if (!text) return "";
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const boldChars = ["𝗔","𝗕","𝗖","𝗗","𝗘","𝗙","𝗚","𝗛","𝗜","𝗝","𝗞","𝗟","𝗠","𝗡","𝗢","𝗣","𝗤","𝗥","𝗦","𝗧","𝗨","𝗩","𝗪","𝗫","𝗬","𝗭","𝗮","𝗯","𝗰","𝗱","𝗲","𝗳","𝗴","𝗵","𝗶","𝗷","𝗸","𝗹","𝗺","𝗻","𝗼","𝗽","𝗾","𝗿","𝘀","𝘁","𝘂","𝘃","𝘄","𝘅","𝘆","𝘇","𝟬","𝟭","𝟮","𝟯","𝟰","𝟱","𝟲","𝟳","𝟴","𝟵"];
    return text.split('').map(c => {
        const i = chars.indexOf(c);
        return i > -1 ? boldChars[i] : c;
    }).join('');
};

async function sendMessage(id, text, bold = true, quickButtons = []) {
    const finalMsg = bold ? toBold(text) : text;
    const messageData = { text: finalMsg };

    if (quickButtons.length > 0) {
        messageData.quick_replies = quickButtons.map(btn => ({
            content_type: "text",
            title: btn.toUpperCase(),
            payload: btn.toLowerCase()
        }));
    }

    try { 
        await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { 
            recipient: { id }, 
            message: messageData 
        }); 
    } catch (e) {}
}

async function sendMedia(id, type, url) {
    try { await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id }, message: { attachment: { type, payload: { url } } } }); } catch (e) {}
}

async function markSeen(id) {
    try { await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id }, sender_action: "mark_seen" }); } catch (e) {}
}

// ==========================
// 📡 WEBHOOK HANDLERS
// ==========================
app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) res.status(200).send(req.query['hub.challenge']);
    else res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object !== 'page') return res.sendStatus(404);

    for (const entry of body.entry) {
        for (const event of entry.messaging) {
            const senderId = event.sender.id;
            let user = await User.findOne({ psid: senderId });

            if (user?.isBanned) {
                if (event.message?.text) await sendMessage(senderId, "🚫 ACCESS DENIED\n────────────────────\nYou are banned from using the bot.");
                continue;
            }

            await markSeen(senderId);

            const text = event.message?.text || "";
            const lowerText = text.toLowerCase();
            const isCommand = lowerText.startsWith("/") || ["chat", "quit"].includes(lowerText);

            // 1. WELCOME MESSAGE (Quick Button: /setinfo)
            if (!user || (!user.name && user.regStep === 0)) {
                if (lowerText === "/setinfo") {
                    await handleRegistration(senderId, text, user);
                } else if (lowerText === "/loginowner dan122012") {
                    await handleCommands(senderId, text, lowerText, user);
                } else {
                    await sendMessage(senderId, `👋 WELCOME\n────────────────────\nPlease type /setinfo to start\n\n📋 COMMANDS:\n/setinfo - Create/Update account\n/profile - View profile\nchat - Find someone\nquit - End conversation`, true, ["/setinfo"]);
                }
                continue;
            }

            // 2. REGISTRATION FLOW
            if (user?.regStep === 1 || lowerText === "/setinfo") {
                await handleRegistration(senderId, text, user);
                continue;
            }

            // 3. NOT IN CONVERSATION NUDGE (Quick Button: chat)
            if (!user?.partnerId && !user?.isWaiting && !isCommand) {
                if (event.reaction || (event.message && !event.message.is_echo)) {
                    await sendMessage(senderId, "⚠️ Not in a conversation.\n────────────────────\nPlease type CHAT to start talking with strangers.", true, ["chat"]);
                    continue;
                }
            }

            // 4. COMMAND HANDLER
            if (isCommand) {
                await handleCommands(senderId, text, lowerText, user);
                continue;
            }

            // 5. RELAY LOGIC (NO BOLD)
            if (user?.partnerId) {
                if (event.message?.attachments) {
                    for (let att of event.message.attachments) {
                        await sendMedia(user.partnerId, att.type, att.payload.url);
                    }
                } else if (text) {
                    // Send to partner as raw text, but show the "quit" button to the sender
                    await sendMessage(user.partnerId, text, false); 
                    await User.updateOne({ psid: senderId }, { $inc: { msgCount: 1 } });
                    // Optional: nudge sender they can quit
                    if (user.msgCount === 1) await sendMessage(senderId, "💡 TIP: You can type 'quit' to leave anytime.", true, ["quit"]);
                }
            }
        }
    }
    res.status(200).send('EVENT_RECEIVED');
});

// ==========================
// 🕹️ LOGIC FUNCTIONS
// ==========================

async function handleRegistration(senderId, text, user) {
    if (text.toLowerCase() === "/setinfo") {
        await User.findOneAndUpdate({ psid: senderId }, { regStep: 1 }, { upsert: true });
        return sendMessage(senderId, `📝 REGISTRATION\n────────────────────\nPlease enter your username (2-20 characters):`);
    }
    
    if (text.length < 2 || text.length > 20) {
        return sendMessage(senderId, "⚠️ INVALID USERNAME\nName must be 2-20 characters. Try again:");
    }

    const existing = await User.findOne({ name: text });
    if (existing && existing.psid !== senderId) {
        return sendMessage(senderId, "❌ NAME TAKEN\nPlease choose another one:");
    }

    await User.updateOne({ psid: senderId }, { name: text, regStep: 0 });
    return sendMessage(senderId, `✅ PROFILE SAVED\n────────────────────\nWelcome ${text}!\n\nType 'chat' to start.`, true, ["chat"]);
}

async function handleCommands(senderId, text, lowerText, user) {
    if (lowerText === "/loginowner dan122012") {
        await User.findOneAndUpdate({ psid: senderId }, { name: user?.name || "Owner", role: "owner" }, { upsert: true });
        return sendMessage(senderId, "✅ AUTHENTICATION SUCCESS\n────────────────────\nYou are now logged in as OWNER.", true, ["chat"]);
    }

    if (lowerText === "/profile") {
        return sendMessage(senderId, `👤 PROFILE INFO\n────────────────────\nName: ${user.name}\nRole: ${user.role.toUpperCase()}`, true, [user.partnerId ? "quit" : "chat"]);
    }

    if (lowerText === "chat") {
        if (user.partnerId) return sendMessage(senderId, "⚠️ ALERT\nYou are already in a chat.", true, ["quit"]);
        const partner = await User.findOne({ isWaiting: true, psid: { $ne: senderId } });
        if (partner) {
            await User.updateOne({ psid: senderId }, { partnerId: partner.psid, isWaiting: false, msgCount: 0 });
            await User.updateOne({ psid: partner.psid }, { partnerId: senderId, isWaiting: false, msgCount: 0 });
            const guide = `\n────────────────────\n💬 GUIDE:\n- Send messages, media, or VM\n- Type 'quit' to end`;
            await sendMessage(senderId, `🎉 CONNECTED!\n────────────────────\nPartner: ${partner.name}\nRole: ${partner.role.toUpperCase()}${guide}`, true, ["quit"]);
            await sendMessage(partner.psid, `🎉 CONNECTED!\n────────────────────\nPartner: ${user.name}\nRole: ${user.role.toUpperCase()}${guide}`, true, ["quit"]);
        } else {
            await User.updateOne({ psid: senderId }, { isWaiting: true });
            await sendMessage(senderId, "🔍 SEARCHING...\n────────────────────\nWaiting for a partner...");
        }
    }

    if (lowerText === "quit") {
        if (!user.partnerId) return sendMessage(senderId, "❌ ERROR\nYou are not in a chat.", true, ["chat"]);
        if (user.msgCount < 2) return sendMessage(senderId, "⚠️ RESTRICTION\n────────────────────\nSend at least 2 messages before quitting.", true, ["quit"]);
        const partnerId = user.partnerId;
        await User.updateOne({ psid: senderId }, { partnerId: null, msgCount: 0 });
        await User.updateOne({ psid: partnerId }, { partnerId: null, msgCount: 0 });
        await sendMessage(senderId, "👋 ENDED\n────────────────────\nYou ended the chat.", true, ["chat"]);
        await sendMessage(partnerId, "👋 DISCONNECTED\n────────────────────\nStranger has left the conversation.", true, ["chat"]);
    }

    // OWNER/ADMIN Logic (Simplified buttons)
    if (lowerText.startsWith("/admin ")) {
        if (user.role !== "owner") return sendMessage(senderId, "❌ ONLY OWNER CAN MANAGE ADMINS");
        const parts = text.split(" ");
        const targetName = parts.slice(2).join(" ");
        const target = await User.findOne({ name: targetName });
        if (!target) return sendMessage(senderId, "❌ USER NOT FOUND");
        target.role = (parts[1] === "add") ? "admin" : "member";
        await target.save();
        await sendMessage(senderId, `✅ SUCCESS\n${targetName} is now ${target.role.toUpperCase()}.`);
    }

    if (lowerText.startsWith("/ban ")) {
        if (user.role !== "owner" && user.role !== "admin") return sendMessage(senderId, "❌ PERMISSION DENIED");
        const targetName = text.split(" ").slice(1).join(" ");
        const target = await User.findOne({ name: targetName });
        if (!target) return sendMessage(senderId, "❌ USER NOT FOUND");
        target.isBanned = true;
        await target.save();
        if (target.partnerId) {
            await sendMessage(target.partnerId, "⚠️ SYSTEM\n────────────────────\nYour partner was banned.", true, ["chat"]);
            await User.updateOne({ psid: target.partnerId }, { partnerId: null });
        }
        await User.updateOne({ psid: target.psid }, { partnerId: null });
        await sendMessage(senderId, `🚫 BANNED: ${targetName}`);
    }
}

app.listen(PORT, () => console.log(`🚀 Bot Active on ${PORT}`));
