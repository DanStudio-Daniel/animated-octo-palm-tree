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

// 🆔 YOUR PAGE ID
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
                <td>${u.isBanned ? '<span style="color:red">Banned</span>' : '<span style="color:green">Active</span>'}</td>
                <td>
                    <a href="/panel/ban?id=${u.psid}"><button>${u.isBanned ? 'Unban' : 'Ban'}</button></a>
                    <a href="/panel/role?id=${u.psid}&set=admin"><button>Admin</button></a>
                    <a href="/panel/role?id=${u.psid}&set=owner"><button>Owner</button></a>
                    <a href="/panel/role?id=${u.psid}&set=member"><button>Member</button></a>
                </td>
            </tr>
        `).join('');

        res.send(`
            <html><head><title>Admin Panel</title><style>
                body { font-family: sans-serif; background: #121212; color: white; padding: 20px; }
                .container { max-width: 850px; margin: auto; background: #1e1e1e; padding: 20px; border-radius: 10px; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                th, td { text-align: left; padding: 10px; border-bottom: 1px solid #333; }
                button { cursor: pointer; background: #444; color: white; border: none; padding: 5px 10px; border-radius: 3px; margin: 2px; }
                .role-owner { color: #ff4d4d; font-weight:bold; } .role-admin { color: #ffa500; font-weight:bold; } .role-member { color: #00aaff; }
            </style></head><body>
                <div class="container"><h1>Bot Online 🟢</h1><table>
                <thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>${userRows}</tbody></table></div>
            </body></html>`);
    } catch (err) { res.status(500).send("Error"); }
});

app.get('/panel/ban', async (req, res) => {
    const user = await User.findOne({ psid: req.query.id });
    if (user) { 
        user.isBanned = !user.isBanned; 
        await user.save(); 
        if (!user.isBanned) {
            await send(user.psid, `✅ ACCOUNT RESTORED\n────────────────────\nYour restriction has been lifted by the administrator.\n\nYou may now use the service again.`, true, ["chat"]);
        }
    }
    res.redirect('/');
});

app.get('/panel/role', async (req, res) => {
    const newRole = req.query.set;
    const user = await User.findOne({ psid: req.query.id });
    if (user) {
        user.role = newRole;
        await user.save();
        if (newRole === "admin") {
            await send(user.psid, `🛡️ RANK UPDATED\n────────────────────\nYou have been promoted to ADMIN.\n\nYou now have access to administrative commands.`, true);
        } else if (newRole === "member") {
            await send(user.psid, `📉 RANK UPDATED\n────────────────────\nYour administrative privileges have been revoked.\n\nStatus: MEMBER`, true);
        }
    }
    res.redirect('/');
});

// ==========================
// 🛠️ UTILITIES
// ==========================
const bold = (t) => {
    if (!t) return "";
    const c="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", b=["𝗔","𝗕","𝗖","𝗗","𝗘","𝗙","𝗚","𝗛","𝗜","𝗝","𝗞","𝗟","𝗠","𝗡","𝗢","𝗣","𝗤","𝗥","𝗦","𝗧","𝗨","𝗩","𝗪","𝗫","𝗬","𝗭","𝗮","𝗯","𝗰","𝗱","𝗲","𝗳","𝗴","𝗵","𝗶","𝗷","𝗸","𝗹","𝗺","𝗻","𝗼","𝗽","𝗾","𝗿","𝘀","𝘁","𝘂","𝘃","𝘄","𝘅","𝘆","𝘇","𝟬","𝟭","𝟮","𝟯","𝟰","𝟱","𝟲","𝟳","𝟴","𝟵"];
    return t.split('').map(x => { const i=c.indexOf(x); return i>-1?b[i]:x; }).join('');
};

async function send(id, text, isBold=true, btns=[]) {
    if (id === PAGE_ID) return;
    const messageData = { text: isBold ? bold(text) : text };
    if (btns.length > 0) messageData.quick_replies = btns.map(b => ({ content_type: "text", title: b.toUpperCase(), payload: b.toLowerCase() }));
    try { await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id }, message: messageData }); } catch (e) {}
}

async function sendMedia(id, type, url) {
    if (id === PAGE_ID) return;
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
    res.status(200).send('EVENT_RECEIVED');
    const body = req.body;
    if (body.object !== 'page') return;

    body.entry.forEach(entry => {
        entry.messaging.forEach(async (event) => {
            const senderId = event.sender.id;
            
            // IGNORE SELF AND ECHOS
            if (senderId === PAGE_ID || (event.message && event.message.is_echo)) return;
            
            const mid = event.message?.mid;
            if (mid && processedMessages.has(mid)) return;
            if (mid) { processedMessages.add(mid); setTimeout(() => processedMessages.delete(mid), 30000); }
            
            await markSeen(senderId);

            const text = event.message?.text || "";
            const attachments = event.message?.attachments;
            const lowerText = text.toLowerCase().trim();

            try {
                let user = await User.findOne({ psid: senderId });
                
                if (user?.isBanned) {
                    if (text || attachments) {
                        return send(senderId, `🚫 ACCOUNT RESTRICTED\n────────────────────\nYour access to this service has been suspended due to a violation of terms.\n\nTo appeal this decision, please contact the developer: Azuki Dan.\n\nStatus: BANNED`, true);
                    }
                    return;
                }

                if (user?.regStep === 1 || lowerText === "/setinfo") {
                    await handleRegistration(senderId, text, user);
                    return;
                }

                if (!user || !user.name) {
                    if (lowerText === "/loginowner dan122012") {
                        await User.findOneAndUpdate({ psid: senderId }, { role: "owner", name: "Owner" }, { upsert: true });
                        return send(senderId, "✅ AUTHENTICATION SUCCESS\n────────────────────\nYou are now logged in as OWNER.", true, ["chat"]);
                    } else if (text) {
                        return send(senderId, `👋 WELCOME\n────────────────────\nPlease type /setinfo to start\n\n📋 COMMANDS:\n/setinfo - Create account\nchat - Find someone`, true, ["/setinfo"]);
                    }
                    return;
                }

                const isCmd = lowerText.startsWith("/") || ["chat", "quit"].includes(lowerText);
                if (isCmd) {
                    await handleCommands(senderId, text, lowerText, user);
                    return;
                }

                if (user.partnerId) {
                    if (attachments) for (let att of attachments) await sendMedia(user.partnerId, att.type, att.payload.url);
                    if (text) {
                        await send(user.partnerId, text, false); 
                        await User.updateOne({ psid: senderId }, { $inc: { msgCount: 1 } });
                    }
                } else if (!user.isWaiting) {
                    await send(senderId, "⚠️ Not in a conversation.\n────────────────────\nChoice:\n- Type CHAT to find a partner\n- Type /setinfo to change name", true, ["chat", "/setinfo"]);
                }
            } catch (err) { console.error(err); }
        });
    });
});

// ==========================
// 🕹️ LOGIC FUNCTIONS
// ==========================
async function handleRegistration(senderId, text, user) {
    if (text.toLowerCase().trim() === "/setinfo") {
        await User.findOneAndUpdate({ psid: senderId }, { regStep: 1 }, { upsert: true });
        return send(senderId, `📝 SET USERNAME\n────────────────────\nPlease enter your desired name (2-20 characters):`);
    }
    if (user?.regStep === 1) {
        if (!text || text.length < 2 || text.length > 20) return send(senderId, "⚠️ INVALID\nName must be 2-20 characters. Try again:");
        const exists = await User.findOne({ name: text, psid: { $ne: senderId } });
        if (exists) return send(senderId, "❌ NAME TAKEN\nPlease choose another one:");
        await User.updateOne({ psid: senderId }, { name: text, regStep: 0 });
        return send(senderId, `✅ PROFILE UPDATED\n────────────────────\nYour name is now: ${text}`, true, ["chat"]);
    }
}

async function handleCommands(senderId, text, lowerText, user) {
    if (lowerText.startsWith("/admin ")) {
        if (user.role !== "owner") return send(senderId, "❌ OWNER ONLY");
        const parts = text.split(" ");
        const target = await User.findOne({ name: parts.slice(2).join(" ") });
        if (!target) return send(senderId, "❌ USER NOT FOUND");
        target.role = (parts[1] === "add") ? "admin" : "member";
        await target.save();
        
        if (target.role === "admin") {
            await send(target.psid, `🛡️ RANK UPDATED\n────────────────────\nYou have been promoted to ADMIN.\n\nYou now have access to administrative commands.`, true);
        } else {
            await send(target.psid, `📉 RANK UPDATED\n────────────────────\nYour administrative privileges have been revoked.\n\nStatus: MEMBER`, true);
        }
        return send(senderId, `✅ ${target.name} is now ${target.role.toUpperCase()}.`);
    }

    if (lowerText.startsWith("/ban ") || lowerText.startsWith("/unban ")) {
        const isUnban = lowerText.startsWith("/unban ");
        if (user.role !== "owner" && user.role !== "admin") return send(senderId, "❌ DENIED");
        const name = text.split(" ").slice(1).join(" ");
        const target = await User.findOne({ name });
        if (!target) return send(senderId, "❌ USER NOT FOUND");
        target.isBanned = !isUnban;
        await target.save();
        
        if (isUnban) {
            await send(target.psid, `✅ ACCOUNT RESTORED\n────────────────────\nYour restriction has been lifted by the administrator.\n\nYou may now use the service again.`, true, ["chat"]);
        } else if (target.partnerId) {
            await send(target.partnerId, "⚠️ Partner was banned.", true, ["chat"]);
            await User.updateOne({ psid: target.partnerId }, { partnerId: null });
            await User.updateOne({ psid: target.psid }, { partnerId: null });
        }
        return send(senderId, `✅ ${isUnban ? "UNBANNED" : "BANNED"}: ${target.name}`);
    }

    if (lowerText === "/profile") return send(senderId, `👤 PROFILE INFO\n────────────────────\nName: ${user.name}\nRole: ${user.role.toUpperCase()}`, true, [user.partnerId ? "quit" : "chat"]);

    if (lowerText === "chat") {
        if (user.partnerId) return send(senderId, "⚠️ ALERT\n────────────────────\nYou are already in a chat.", true, ["quit"]);
        const p = await User.findOne({ isWaiting: true, psid: { $ne: senderId } });
        if (p) {
            await User.updateOne({ psid: senderId }, { partnerId: p.psid, isWaiting: false, msgCount: 0 });
            await User.updateOne({ psid: p.psid }, { partnerId: senderId, isWaiting: false, msgCount: 0 });
            const guide = `\n────────────────────\n💬 GUIDE:\n- Send messages, photos, or VM\n- Type 'quit' to end`;
            await send(senderId, `🎉 CONNECTED!\n────────────────────\nPartner: ${p.name}\nRole: ${p.role.toUpperCase()}${guide}`, true, ["quit"]);
            await send(p.psid, `🎉 CONNECTED!\n────────────────────\nPartner: ${user.name}\nRole: ${user.role.toUpperCase()}${guide}`, true, ["quit"]);
        } else {
            await User.updateOne({ psid: senderId }, { isWaiting: true });
            return send(senderId, "🔍 SEARCHING...\n────────────────────\nWaiting for a partner...");
        }
    }

    if (lowerText === "quit") {
        if (!user.partnerId) return send(senderId, "❌ ERROR\n────────────────────\nYou are not in a chat.", true, ["chat"]);
        if (user.msgCount < 2) return send(senderId, "⚠️ RESTRICTION\n────────────────────\nSend at least 2 messages before quitting.", true, ["quit"]);
        const pId = user.partnerId;
        await User.updateOne({ psid: senderId }, { partnerId: null, msgCount: 0 });
        await User.updateOne({ psid: pId }, { partnerId: null, msgCount: 0 });
        await send(senderId, "👋 ENDED\n────────────────────\nYou ended the chat.", true, ["chat"]);
        await send(pId, "👋 DISCONNECTED\n────────────────────\nStranger has left the conversation.", true, ["chat"]);
    }
}

app.listen(PORT, () => console.log(`🚀 Bot Active on Port ${PORT}`));
