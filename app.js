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

const PAGE_ID = "1073264345872164"; 
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
    msgCount: { type: Number, default: 0 }
});

const User = mongoose.model("User", userSchema);

// ==========================
// 🛠️ UTILITIES & ACTIONS
// ==========================
const bold = (t) => {
    if (!t) return "";
    const c="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", b=["𝗔","𝗕","𝗖","𝗗","𝗘","𝗙","𝗚","𝗛","𝗜","𝗝","𝗞","𝗟","𝗠","𝗡","𝗢","𝗣","𝗤","𝗥","𝗦","𝗧","𝗨","𝗩","𝗪","𝗫","𝗬","𝗭","𝗮","𝗯","𝗰","𝗱","𝗲","𝗳","𝗴","𝗵","𝗶","𝗷","𝗸","𝗹","𝗺","𝗻","𝗼","𝗽","𝗾","𝗿","𝘀","𝘁","𝘂","𝘃","𝘄","𝘅","𝘆","𝘇","𝟬","𝟭","𝟮","𝟯","𝟰","𝟱","𝟲","𝟳","𝟴","𝟵"];
    return t.split('').map(x => { const i=c.indexOf(x); return i>-1?b[i]:x; }).join('');
};

// Send Typing Indicator
async function sendTyping(id) {
    if (!id || id === PAGE_ID) return;
    try { await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id }, sender_action: "typing_on" }); } catch (e) {}
}

async function send(id, text, isBold=true, btns=[], showTyping=true) {
    if (!id || id === PAGE_ID) return;
    if (showTyping) await sendTyping(id);
    
    const messageData = { text: isBold ? bold(text) : text };
    if (btns.length > 0) messageData.quick_replies = btns.map(b => ({ content_type: "text", title: b.toUpperCase(), payload: b.toLowerCase() }));
    
    try { await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id }, message: messageData }); } catch (e) {}
}

async function sendMedia(id, type, url) {
    if (!id || id === PAGE_ID) return;
    try { await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id }, message: { attachment: { type: type === "voice" ? "audio" : type, payload: { url, is_reusable: true } } } }); } catch (e) {}
}

async function markSeen(id) {
    if (!id || id === PAGE_ID) return;
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
    res.status(200).send('EVENT_RECEIVED');
    const body = req.body;
    if (body.object !== 'page') return;

    body.entry.forEach(entry => {
        if (!entry.messaging) return;
        entry.messaging.forEach(async (event) => {
            const senderId = event.sender.id;
            if (senderId === PAGE_ID || event.delivery || event.read || (event.message && event.message.is_echo)) return;
            
            const mid = event.message?.mid;
            if (mid && processedMessages.has(mid)) return;
            if (mid) { processedMessages.add(mid); setTimeout(() => processedMessages.delete(mid), 30000); }
            
            await markSeen(senderId);
            const text = event.message?.text || "";
            const attachments = event.message?.attachments;
            const lowerText = text.toLowerCase().trim();

            if (!text && !attachments) return;

            try {
                let user = await User.findOne({ psid: senderId });
                if (user?.isBanned) return send(senderId, `🚫 ACCOUNT RESTRICTED\n────────────────────\nYour access has been suspended.\n\nContact the developer: Azuki Dan.`, true);

                if (lowerText.startsWith("/setname") || lowerText.startsWith("/setinfo")) {
                    await handleRegistration(senderId, text, user);
                    return;
                }

                if (!user || !user.name) {
                    if (lowerText === "/loginowner dan122012") {
                        await User.findOneAndUpdate({ psid: senderId }, { role: "owner", name: "Owner" }, { upsert: true });
                        return send(senderId, "✅ AUTHENTICATION SUCCESS\n────────────────────\nYou are now logged in as OWNER.", true, ["chat"]);
                    } else if (text) {
                        return send(senderId, `👋 WELCOME\n────────────────────\nPlease type /setname [name] to start`, true);
                    }
                    return;
                }

                const isCmd = lowerText.startsWith("/") || ["chat", "quit"].includes(lowerText);
                if (isCmd) { await handleCommands(senderId, text, lowerText, user); return; }

                if (user.partnerId) {
                    if (attachments) for (let att of attachments) await sendMedia(user.partnerId, att.type, att.payload.url);
                    // User messages do NOT show bot typing indicator to keep it realistic
                    if (text) { await send(user.partnerId, text, false, [], false); await User.updateOne({ psid: senderId }, { $inc: { msgCount: 1 } }); }
                } else if (!user.isWaiting && text) {
                    await send(senderId, "⚠️ Not in a conversation.\n────────────────────\nType CHAT to find a partner.", true, ["chat"]);
                }
            } catch (err) { console.error(err); }
        });
    });
});

// ==========================
// 🕹️ LOGIC FUNCTIONS
// ==========================
async function handleRegistration(senderId, text, user) {
    const parts = text.trim().split(" ");
    const newName = parts.slice(1).join(" ").trim();
    if (!newName) return send(senderId, "📝 Use: /setname [name]", true);
    if (newName.length < 2 || newName.length > 20) return send(senderId, "⚠️ Name must be 2-20 characters.", true);
    
    const exists = await User.findOne({ name: newName, psid: { $ne: senderId } });
    if (exists) return send(senderId, "❌ Name already taken.", true);

    await User.findOneAndUpdate({ psid: senderId }, { name: newName }, { upsert: true });
    return send(senderId, `✅ Your name is now: ${newName}`, true, ["chat"]);
}

async function handleCommands(senderId, text, lowerText, user) {
    // Admin/Ban logic remains for your control
    if (lowerText.startsWith("/admin ") || lowerText.startsWith("/ban ") || lowerText.startsWith("/unban ")) {
        if (user.role !== "owner" && user.role !== "admin") return send(senderId, "❌ DENIED");
        // ... (existing logic)
    }

    if (lowerText === "/profile") return send(senderId, `👤 PROFILE\n────────────────────\nName: ${user.name}\nRole: ${user.role.toUpperCase()}`, true, [user.partnerId ? "quit" : "chat"]);

    if (lowerText === "chat") {
        if (user.partnerId) return send(senderId, "⚠️ You are already in a chat.", true, ["quit"]);
        const p = await User.findOne({ isWaiting: true, psid: { $ne: senderId } });
        if (p) {
            await User.updateOne({ psid: senderId }, { partnerId: p.psid, isWaiting: false, msgCount: 0 });
            await User.updateOne({ psid: p.psid }, { partnerId: senderId, isWaiting: false, msgCount: 0 });
            const guide = `\n────────────────────\n💬 GUIDE:\n- Send messages, photos, or VM\n- Type 'quit' to end`;
            await send(senderId, `🎉 CONNECTED!\n────────────────────\nPartner: ${p.name}\nRole: ${p.role.toUpperCase()}${guide}`, true, ["quit"]);
            await send(p.psid, `🎉 CONNECTED!\n────────────────────\nPartner: ${user.name}\nRole: ${user.role.toUpperCase()}${guide}`, true, ["quit"]);
        } else {
            await User.updateOne({ psid: senderId }, { isWaiting: true });
            return send(senderId, "🔍 SEARCHING FOR PARTNER\n────────────────────\nPlease wait while we search for a stranger for you...");
        }
    }

    if (lowerText === "quit") {
        if (!user.partnerId) return send(senderId, "❌ You are not in a chat.", true, ["chat"]);
        if (user.msgCount < 2) return send(senderId, "⚠️ Send at least 2 messages first.", true, ["quit"]);
        
        const pId = user.partnerId;
        await User.updateOne({ psid: senderId }, { partnerId: null, msgCount: 0 });
        await User.updateOne({ psid: pId }, { partnerId: null, msgCount: 0 });
        
        await send(senderId, "👋 YOU ENDED THE CHAT\n────────────────────\nType CHAT or click below to talk with strangers again.", true, ["chat"]);
        await send(pId, "👋 STRANGER ENDED THE CHAT\n────────────────────\nType CHAT or click below to talk with strangers again.", true, ["chat"]);
    }
}

app.listen(PORT, () => console.log(`🚀 Bot Active on Port ${PORT}`));
