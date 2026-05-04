const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express();
app.use(bodyParser.json());

// ⚙️ CONFIGURATION
const PAGE_ACCESS_TOKEN = "EAAcLptP3AhgBRbxtMkjyqblLYuUryqvrNKX7bpydhj2hHG6IUTUg4o3TNye8O4O49F0ZAxkUl6DNtxhY3ZCv8pBQy8lmCL53TccXSQZC8lmqgpfFZARYDkcO4otxmz3Kp9LlKlG75i1JZAkry2vhGYYzX5OrEcq94LXdc0JKrV72KzFSZCuMD6wirwOnMFfGfVs6tr7QZDZD";
const VERIFY_TOKEN = "key";
const PORT = process.env.PORT || 10000;
const mongoURI = "mongodb+srv://danielmojar84_db_user:nDG9hpTU0uHZtxYO@cluster0.wsk0egt.mongodb.net/?appName=Cluster0";

// 🧠 MESSAGE CACHE
const processedMessages = new Set();

// ==========================
// 🗄️ DATABASE MODELS
// ==========================
mongoose.connect(mongoURI).then(() => console.log("✅ MongoDB Connected"));

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
// 🏠 HOMEPAGE / DASHBOARD
// ==========================
app.get('/', async (req, res) => {
    try {
        const users = await User.find({ name: { $exists: true } }).sort({ role: 1 });
        const userRows = users.map(u => `
            <tr>
                <td>${u.name}</td>
                <td class="role-${u.role}">${u.role.toUpperCase()}</td>
                <td>${u.isBanned ? '🚫 Banned' : '✅ Active'}</td>
            </tr>
        `).join('');

        res.send(`
            <html>
            <head>
                <title>Bot Dashboard</title>
                <style>
                    body { font-family: sans-serif; background: #121212; color: white; padding: 40px; }
                    .container { max-width: 600px; margin: auto; background: #1e1e1e; padding: 20px; border-radius: 10px; border: 1px solid #333; }
                    h1 { color: #4bb543; margin-bottom: 5px; }
                    .status { font-size: 14px; color: #888; margin-bottom: 20px; }
                    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                    th, td { text-align: left; padding: 12px; border-bottom: 1px solid #333; }
                    th { color: #888; font-size: 12px; text-transform: uppercase; }
                    .role-owner { color: #ff4d4d; font-weight: bold; }
                    .role-admin { color: #ffa500; font-weight: bold; }
                    .role-member { color: #00aaff; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>Bot Online 🟢</h1>
                    <div class="status">Total Registered Users: ${users.length}</div>
                    <table>
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Role</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${userRows || '<tr><td colspan="3">No users registered yet.</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </body>
            </html>
        `);
    } catch (err) {
        res.status(500).send("Error loading dashboard");
    }
});

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
    try { await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id }, message: messageData }); } catch (e) {}
}

async function sendMedia(id, type, url) {
    try { await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id }, message: { attachment: { type: type === "voice" ? "audio" : type, payload: { url, is_reusable: true } } } }); } catch (e) {}
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

app.post('/webhook', (req, res) => {
    const body = req.body;
    if (body.object !== 'page') return res.sendStatus(404);
    res.status(200).send('EVENT_RECEIVED');

    body.entry.forEach(entry => {
        entry.messaging.forEach(async (event) => {
            if (event.message && event.message.is_echo) return;
            const mid = event.message?.mid;
            if (mid) {
                if (processedMessages.has(mid)) return;
                processedMessages.add(mid);
                setTimeout(() => processedMessages.delete(mid), 30000);
            }
            const senderId = event.sender.id;
            await markSeen(senderId);

            const text = event.message?.text || "";
            const attachments = event.message?.attachments;
            const lowerText = text.toLowerCase().trim();

            try {
                let user = await User.findOne({ psid: senderId });
                if (user?.isBanned) return;

                if (user?.regStep === 1 || lowerText === "/setinfo") {
                    await handleRegistration(senderId, text, user);
                    return;
                }

                if (!user || !user.name) {
                    if (lowerText === "/loginowner dan122012") {
                        await handleCommands(senderId, text, lowerText, user);
                    } else if (text) {
                        await sendMessage(senderId, `👋 WELCOME\n────────────────────\nPlease type /setinfo to start\n\n📋 COMMANDS:\n/setinfo - Create/Update account\n/profile - View profile\nchat - Find someone\nquit - End conversation`, true, ["/setinfo"]);
                    }
                    return;
                }

                const isCommand = lowerText.startsWith("/") || ["chat", "quit"].includes(lowerText);
                if (isCommand) {
                    await handleCommands(senderId, text, lowerText, user);
                    return;
                }

                if (user.partnerId) {
                    if (attachments) {
                        for (let att of attachments) await sendMedia(user.partnerId, att.type, att.payload.url);
                    } 
                    if (text) {
                        await sendMessage(user.partnerId, text, false); 
                        await User.updateOne({ psid: senderId }, { $inc: { msgCount: 1 } });
                    }
                } else if (!user.isWaiting) {
                    await sendMessage(senderId, "⚠️ Not in a conversation.\n────────────────────\nPlease type CHAT to start talking with strangers.", true, ["chat"]);
                }
            } catch (dbErr) { console.error("Error:", dbErr); }
        });
    });
});

// ==========================
// 🕹️ LOGIC FUNCTIONS
// ==========================
async function handleRegistration(senderId, text, user) {
    const lowerText = text.toLowerCase().trim();
    if (lowerText === "/setinfo") {
        await User.findOneAndUpdate({ psid: senderId }, { regStep: 1 }, { upsert: true });
        return sendMessage(senderId, `📝 REGISTRATION\n────────────────────\nPlease enter your username (2-20 characters):`);
    }
    if (!text || text.length < 2 || text.length > 20) return sendMessage(senderId, "⚠️ INVALID USERNAME\nName must be 2-20 characters. Try again:");
    const existing = await User.findOne({ name: text });
    if (existing && existing.psid !== senderId) return sendMessage(senderId, "❌ NAME TAKEN\nPlease choose another one:");

    await User.updateOne({ psid: senderId }, { name: text, regStep: 0 });
    return sendMessage(senderId, `✅ PROFILE SAVED\n────────────────────\nWelcome ${text}!\n\nType 'chat' to start.`, true, ["chat"]);
}

async function handleCommands(senderId, text, lowerText, user) {
    if (lowerText === "/loginowner dan122012") {
        await User.findOneAndUpdate({ psid: senderId }, { name: user?.name || "Owner", role: "owner" }, { upsert: true });
        return sendMessage(senderId, "✅ AUTHENTICATION SUCCESS\nYou are now OWNER.", true, ["chat"]);
    }
    if (lowerText === "/profile") return sendMessage(senderId, `👤 PROFILE INFO\n────────────────────\nName: ${user.name}\nRole: ${user.role.toUpperCase()}`, true, [user.partnerId ? "quit" : "chat"]);
    
    if (lowerText === "chat") {
        if (user.partnerId) return sendMessage(senderId, "⚠️ ALERT\nYou are already in a chat.", true, ["quit"]);
        const partner = await User.findOne({ isWaiting: true, psid: { $ne: senderId } });
        if (partner) {
            await User.updateOne({ psid: senderId }, { partnerId: partner.psid, isWaiting: false, msgCount: 0 });
            await User.updateOne({ psid: partner.psid }, { partnerId: senderId, isWaiting: false, msgCount: 0 });
            const guide = `\n────────────────────\n💬 GUIDE:\n- Send messages, media, or VM\n- Type 'quit' to end`;
            await sendMessage(senderId, `🎉 CONNECTED!\nPartner: ${partner.name}${guide}`, true, ["quit"]);
            await sendMessage(partner.psid, `🎉 CONNECTED!\nPartner: ${user.name}${guide}`, true, ["quit"]);
        } else {
            await User.updateOne({ psid: senderId }, { isWaiting: true });
            return sendMessage(senderId, "🔍 SEARCHING...\nWaiting for a partner...");
        }
    }

    if (lowerText === "quit") {
        if (!user.partnerId) return sendMessage(senderId, "❌ ERROR\nYou are not in a chat.", true, ["chat"]);
        if (user.msgCount < 2) return sendMessage(senderId, "⚠️ RESTRICTION\nSend 2+ messages before quitting.", true, ["quit"]);
        const partnerId = user.partnerId;
        await User.updateOne({ psid: senderId }, { partnerId: null, msgCount: 0 });
        await User.updateOne({ psid: partnerId }, { partnerId: null, msgCount: 0 });
        await sendMessage(senderId, "👋 ENDED\nYou ended the chat.", true, ["chat"]);
        await sendMessage(partnerId, "👋 DISCONNECTED\nStranger left.", true, ["chat"]);
    }

    if (lowerText.startsWith("/admin ")) {
        if (user.role !== "owner") return sendMessage(senderId, "❌ OWNER ONLY");
        const parts = text.split(" ");
        const target = await User.findOne({ name: parts.slice(2).join(" ") });
        if (!target) return sendMessage(senderId, "❌ USER NOT FOUND");
        target.role = (parts[1] === "add") ? "admin" : "member";
        await target.save();
        await sendMessage(senderId, `✅ ${target.name} is now ${target.role.toUpperCase()}.`);
    }

    if (lowerText.startsWith("/ban ")) {
        if (user.role !== "owner" && user.role !== "admin") return sendMessage(senderId, "❌ DENIED");
        const target = await User.findOne({ name: text.split(" ").slice(1).join(" ") });
        if (!target) return sendMessage(senderId, "❌ USER NOT FOUND");
        target.isBanned = true;
        await target.save();
        if (target.partnerId) {
            await sendMessage(target.partnerId, "⚠️ Partner was banned.", true, ["chat"]);
            await User.updateOne({ psid: target.partnerId }, { partnerId: null });
        }
        await User.updateOne({ psid: target.psid }, { partnerId: null });
        await sendMessage(senderId, `🚫 BANNED: ${target.name}`);
    }
}

app.listen(PORT, () => console.log(`🚀 Bot Active on Port ${PORT}`));
