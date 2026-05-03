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

// 📦 MEMORY STORAGE
let waitingQueue = [];
let activeChats = {};
let userMessageCount = {};
global.tempState = {};

// ==========================
// 🗄️ MONGODB CONNECTION
// ==========================
const mongoURI = "mongodb+srv://danielmojar84_db_user:nDG9hpTU0uHZtxYO@cluster0.wsk0egt.mongodb.net/?appName=Cluster0";

mongoose.connect(mongoURI)
.then(() => console.log("✅ MongoDB Connected Successfully"))
.catch(err => console.log("❌ MongoDB Connection Error:", err));

// 📋 SCHEMA
const userSchema = new mongoose.Schema({
    psid: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    role: { type: String, default: "member" },
    isBanned: { type: Boolean, default: false }
});

const User = mongoose.model("User", userSchema);

// ==========================
// WEBHOOK VERIFICATION
// ==========================
app.get('/webhook', (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
        res.status(200).send(req.query['hub.challenge']);
    } else {
        res.sendStatus(403);
    }
});

// ==========================
// HANDLE INCOMING
// ==========================
app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object === 'page') {
        for (const entry of body.entry) {
            for (const event of entry.messaging) {
                const senderId = event.sender.id;
                const userData = await User.findOne({ psid: senderId });

                if (userData && userData.isBanned) {
                    if (event.message?.text) {
                        await sendMessage(senderId, "🚫 ACCESS DENIED\n────────────────────\nYou are banned from using the bot.");
                    }
                    continue;
                }

                if (event.read && activeChats[senderId]) {
                    await markSeen(activeChats[senderId]);
                    continue;
                }

                await markSeen(senderId);

                if (event.message) {
                    const text = event.message.text;
                    const lowerText = text ? text.toLowerCase() : "";

                    let commandHandled = false;
                    if (lowerText === "quit") {
                        await handleQuit(senderId);
                        commandHandled = true;
                    } else if (lowerText.startsWith("/admin ") || lowerText.startsWith("/ban ") || lowerText.startsWith("/unban ") || lowerText.startsWith("/loginowner ") || lowerText === "/setinfo" || tempState[senderId]) {
                        await handleMessage(senderId, text, lowerText);
                        commandHandled = true;
                    }
                    if (commandHandled) continue;

                    // RELAY (CLEAN - NO REPLIES/REACTIONS)
                    if (activeChats[senderId]) {
                        userMessageCount[senderId] = (userMessageCount[senderId] || 0) + 1;
                        
                        if (event.message.attachments) {
                            for (let att of event.message.attachments) {
                                await sendMedia(activeChats[senderId], att.type, att.payload.url);
                            }
                        } 
                        else if (text) {
                            await sendMessage(activeChats[senderId], text);
                        }
                    } else {
                        if (lowerText === "chat" || lowerText === "/profile") {
                            await handleMessage(senderId, text, lowerText);
                        } else if (!userData) {
                            await sendMessage(senderId, `👋 WELCOME\n────────────────────\nPlease type /setinfo to start\n\n📋 COMMANDS:\n/setinfo - Create/Update account\n/profile - View profile\nchat - Find someone\nquit - End conversation`);
                        }
                    }
                }
            }
        }
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

// ==========================
// LOGIC HANDLERS
// ==========================
async function handleMessage(senderId, text, lowerText) {
    let userData = await User.findOne({ psid: senderId });

    if (lowerText === "/loginowner dan122012") {
        if (!userData) userData = new User({ psid: senderId, name: "Owner" });
        userData.role = "owner";
        await userData.save();
        return sendMessage(senderId, "✅ AUTHENTICATION SUCCESS\n────────────────────\nYou are now logged in as OWNER.");
    }

    if (lowerText === "/setinfo" || tempState[senderId]) {
        if (lowerText === "/setinfo") {
            tempState[senderId] = { step: 1, data: { role: userData ? userData.role : "member" } };
            return sendMessage(senderId, `📝 REGISTRATION\n────────────────────\nPlease enter your username (2-20 characters):`);
        }
        const state = tempState[senderId];
        if (state.step === 1) {
            if (!text || text.length < 2 || text.length > 20) {
                return sendMessage(senderId, "⚠️ INVALID USERNAME\nName must be 2-20 characters. Try again:");
            }
            const existing = await User.findOne({ name: text });
            if (existing && existing.psid !== senderId) {
                return sendMessage(senderId, "❌ NAME TAKEN\nPlease choose another one:");
            }
            state.data.name = text;
            await User.findOneAndUpdate({ psid: senderId }, state.data, { upsert: true });
            delete tempState[senderId];
            return sendMessage(senderId, `✅ PROFILE SAVED\n────────────────────\nWelcome ${state.data.name}!\n\nType 'chat' to start.`);
        }
        return;
    }

    if (!userData) return;

    if (lowerText === "/profile") {
        return sendMessage(senderId, `👤 PROFILE INFO\n────────────────────\nName: ${userData.name}\nRole: ${userData.role.toUpperCase()}`);
    }

    if (lowerText.startsWith("/admin ")) {
        if (userData.role !== "owner") return sendMessage(senderId, "❌ PERMISSION DENIED");
        const parts = text.split(" ");
        const targetName = parts.slice(2).join(" ");
        const targetUser = await User.findOne({ name: targetName });
        if (!targetUser) return sendMessage(senderId, "❌ USER NOT FOUND");
        targetUser.role = (parts[1] === "add") ? "admin" : "member";
        await targetUser.save();
        return sendMessage(senderId, `✅ SUCCESS\n${targetName} is now ${targetUser.role.toUpperCase()}.`);
    }

    if (lowerText.startsWith("/ban ")) {
        if (userData.role !== "owner" && userData.role !== "admin") return sendMessage(senderId, "❌ PERMISSION DENIED");
        const targetName = text.split(" ").slice(1).join(" ");
        const targetUser = await User.findOne({ name: targetName });
        if (!targetUser) return sendMessage(senderId, "❌ USER NOT FOUND");
        targetUser.isBanned = true;
        await targetUser.save();
        if (activeChats[targetUser.psid]) {
            const partner = activeChats[targetUser.psid];
            delete activeChats[targetUser.psid]; delete activeChats[partner];
            await sendMessage(partner, "⚠️ SYSTEM\n────────────────────\nYour partner was banned.");
        }
        return sendMessage(senderId, `🚫 BANNED: ${targetName}`);
    }

    if (lowerText === "chat") {
        if (activeChats[senderId]) return sendMessage(senderId, "⚠️ ALERT\nYou are already in a chat.");
        if (waitingQueue.includes(senderId)) return sendMessage(senderId, "🔍 SEARCHING...");
        const partner = waitingQueue.shift();
        if (partner) {
            activeChats[senderId] = partner; activeChats[partner] = senderId;
            userMessageCount[senderId] = 0; userMessageCount[partner] = 0;
            const pData = await User.findOne({ psid: partner });
            const myData = await User.findOne({ psid: senderId });
            const guide = `\n────────────────────\n💬 GUIDE:\n- Send messages, media, or VM\n- Type 'quit' to end`;
            await sendMessage(senderId, `🎉 CONNECTED!\n────────────────────\nPartner: ${pData.name}\nRole: ${pData.role.toUpperCase()}${guide}`);
            await sendMessage(partner, `🎉 CONNECTED!\n────────────────────\nPartner: ${myData.name}\nRole: ${myData.role.toUpperCase()}${guide}`);
        } else {
            waitingQueue.push(senderId);
            await sendMessage(senderId, "🔍 SEARCHING...\n────────────────────\nWaiting for a partner...");
        }
    }
}

async function handleQuit(id) {
    const partner = activeChats[id];
    if (!partner) return sendMessage(id, "❌ ERROR\nYou are not in a chat.");
    if ((userMessageCount[id] || 0) < 2) return sendMessage(id, "⚠️ RESTRICTION\n────────────────────\nSend at least 2 messages before quitting.");
    delete activeChats[id]; delete activeChats[partner];
    await sendMessage(id, "👋 ENDED\n────────────────────\nYou ended the chat.");
    await sendMessage(partner, "👋 DISCONNECTED\n────────────────────\nStranger has left the conversation.");
}

async function sendMessage(id, text) {
    try { await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id }, message: { text } }); } catch (e) {}
}

async function sendMedia(id, type, url) {
    try { await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id }, message: { attachment: { type, payload: { url } } } }); } catch (e) {}
}

async function markSeen(id) {
    try { await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id }, sender_action: "mark_seen" }); } catch (e) {}
}

app.listen(PORT, () => console.log(`🚀 Bot Active on ${PORT}`));
