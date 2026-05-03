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
const PAGE_ACCESS_TOKEN = "EAAcLptP3AhgBRVaudVLZCUnjnZCNvMNBjsN1vtW3circdCouQQit1r6oEp3kMVbRJJUplqd6YFFqPySY15rksGpZClkFbOItZCf7Vkxf7ZBctmxGAxghQDfGYWaP7fYLNROXH6UDCSWgttQYEHQqww7IOpZBxMNJLnX4dyWGH12cKlVtXuKlAQCSzlOAnLntvbfnZAmDAZDZD";
const VERIFY_TOKEN = "key";
const OWNER_PASSWORD = "dan122012";
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

// 📋 SCHEMA & MODEL
const userSchema = new mongoose.Schema({
    psid: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    age: { type: Number, required: true },
    role: { type: String, default: "member" },
    isBanned: { type: Boolean, default: false }
});

const User = mongoose.model("User", userSchema);

// Helper for Unicode Bold (Reliable character mapping)
const toBold = (text) => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const boldChars = ["𝗔","𝗕","𝗖","𝗗","𝗘","𝗙","𝗚","𝗛","𝗜","𝗝","𝗞","𝗟","𝗠","𝗡","𝗢","𝗣","𝗤","𝗥","𝗦","𝗧","𝗨","𝗩","𝗪","𝗫","𝗬","𝗭","𝗮","𝗯","𝗰","𝗱","𝗲","𝗳","𝗴","𝗵","𝗶","𝗷","𝗸","𝗹","𝗺","𝗻","𝗼","𝗽","𝗾","𝗿","𝘀","𝘁","𝘂","𝘃","𝘄","𝘅","𝘆","𝘇","𝟬","𝟭","𝟮","𝟯","𝟰","𝟱","𝟲","𝟳","𝟴","𝟵"];
    return text.split('').map(c => {
        const i = chars.indexOf(c);
        return i > -1 ? boldChars[i] : c;
    }).join('');
};

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
// HANDLE INCOMING MESSAGES
// ==========================
app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object === 'page') {
        body.entry.forEach(entry => {
            entry.messaging.forEach(async event => {
                const senderId = event.sender.id;
                const userData = await User.findOne({ psid: senderId });

                // 🚫 BANNED CHECK
                if (userData && userData.isBanned) {
                    if (event.message && event.message.text) {
                        await sendMessage(senderId, "🚫 ACCESS DENIED\n────────────────────\nYou are banned from using the bot for violating our community guidelines. If you think this is a mistake or wish to appeal your restriction, please contact Azuki Dan for further assistance.");
                    }
                    return;
                }

                // HANDLE REACTIONS
                if (event.reaction && activeChats[senderId]) {
                    const reaction = event.reaction.reaction;
                    const emojiMap = { 'love': '❤️', 'smile': '😄', 'wow': '😮', 'sad': '😢', 'angry': '😠', 'like': '👍', 'dislike': '👎' };
                    const displayEmoji = emojiMap[reaction] || reaction;
                    const targetText = event.reaction.text || "a message";
                    const ownerLabel = event.reaction.mid ? "your" : "their";
                    
                    const reactionMsg = toBold(`reacted ${displayEmoji} to ${ownerLabel} message "${targetText}"`);
                    await sendMessage(activeChats[senderId], reactionMsg);
                    return;
                }

                if (event.read && activeChats[senderId]) {
                    await markSeen(activeChats[senderId]);
                    return;
                }

                await markSeen(senderId);

                if (event.message) {
                    const text = event.message.text;
                    const lowerText = text ? text.toLowerCase() : "";

                    // COMMANDS
                    let commandHandled = false;
                    if (lowerText === "quit") {
                        await handleQuit(senderId);
                        commandHandled = true;
                    }
                    else if (lowerText.startsWith("/admin ") || lowerText.startsWith("/ban ") || lowerText.startsWith("/unban ") || lowerText.startsWith("/loginowner ") || lowerText === "/setinfo" || tempState[senderId]) {
                        await handleMessage(senderId, text, lowerText);
                        commandHandled = true;
                    }
                    if (commandHandled) return;

                    // CHAT RELAY
                    if (activeChats[senderId]) {
                        userMessageCount[senderId] = (userMessageCount[senderId] || 0) + 1;
                        
                        // Handle Replies (Formatted with Bold)
                        if (event.message.reply_to) {
                            const repliedText = event.message.reply_to.text || "Attachment";
                            const formattedReply = `${toBold(`replied to "${repliedText}"`)}\n\n${text}`;
                            await sendMessage(activeChats[senderId], formattedReply);
                        } 
                        // Handle Media (VM, Video, Image) - NO AUTO FONT
                        else if (event.message.attachments) {
                            for (let att of event.message.attachments) {
                                await sendMedia(activeChats[senderId], att.type, att.payload.url);
                            }
                        } 
                        // Handle Regular Forwarded Text - NO AUTO FONT
                        else if (text) {
                            await sendMessage(activeChats[senderId], text);
                        }
                    } else {
                        if (lowerText === "chat" || lowerText === "/profile") {
                            await handleMessage(senderId, text, lowerText);
                        } else if (!userData) {
                            await sendMessage(senderId, `👋 WELCOME\n────────────────────\nPlease type /setinfo to start\n\n📋 COMMANDS:\n/setinfo - Create/Update account\n/profile - View your profile\nchat - Find someone\nquit - End conversation`);
                        }
                    }
                }
            });
        });
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

// ==========================
// MAIN LOGIC
// ==========================
async function handleMessage(senderId, text, lowerText) {
    let userData = await User.findOne({ psid: senderId });

    if (lowerText === "/loginowner dan122012") {
        if (!userData) userData = new User({ psid: senderId, name: "Owner", age: 1 });
        userData.role = "owner";
        await userData.save();
        return sendMessage(senderId, "✅ AUTHENTICATION SUCCESS\n────────────────────\nYou are now logged in as OWNER.");
    }

    if (lowerText === "/setinfo" || tempState[senderId]) {
        if (lowerText === "/setinfo") {
            const mode = userData ? "UPDATING PROFILE" : "REGISTRATION";
            tempState[senderId] = { step: 1, data: { role: userData ? userData.role : "member" } };
            return sendMessage(senderId, `📝 ${mode}: STEP 1/2\n────────────────────\nPlease enter your username (2-20 characters):`);
        }

        const state = tempState[senderId];
        if (state.step === 1) {
            if (!text || text.length < 2 || text.length > 20) {
                return sendMessage(senderId, "⚠️ INVALID USERNAME\n────────────────────\nName must be 2-20 characters. Try again:");
            }
            const existing = await User.findOne({ name: text });
            if (existing && existing.psid !== senderId) {
                return sendMessage(senderId, "❌ NAME TAKEN\n────────────────────\nThis username is already in use. Please choose another one:");
            }
            state.data.name = text;
            state.step = 2;
            return sendMessage(senderId, `📝 STEP 2/2\n────────────────────\nPlease enter your age (15-100):`);
        }
        
        if (state.step === 2) {
            const ageNum = parseInt(text);
            if (isNaN(ageNum)) return sendMessage(senderId, "❌ TYPE ERROR\n────────────────────\nThat's not a number! Enter age using digits:");
            if (ageNum < 15 || ageNum > 100) return sendMessage(senderId, "⚠️ OUT OF RANGE\n────────────────────\nAge must be between 15-100. Try again:");
            
            state.data.age = ageNum;
            await User.findOneAndUpdate({ psid: senderId }, state.data, { upsert: true });
            delete tempState[senderId];
            return sendMessage(senderId, `✅ PROFILE SAVED\n────────────────────\nWelcome ${state.data.name}!\n\nType 'chat' to start.`);
        }
        return;
    }

    if (!userData) return;

    if (lowerText === "/profile") {
        return sendMessage(senderId, `👤 PROFILE INFO\n────────────────────\nName: ${userData.name}\nAge: ${userData.age}\nRole: ${userData.role.toUpperCase()}`);
    }

    if (lowerText.startsWith("/admin ")) {
        if (userData.role !== "owner") return sendMessage(senderId, "❌ PERMISSION DENIED");
        const parts = text.split(" ");
        const action = parts[1];
        const targetName = parts.slice(2).join(" ");
        const targetUser = await User.findOne({ name: targetName });
        if (!targetUser) return sendMessage(senderId, "❌ USER NOT FOUND");
        if (action === "add") {
            targetUser.role = "admin";
            await targetUser.save();
            return sendMessage(senderId, `✅ SUCCESS\n${targetName} is now admin.`);
        } else if (action === "remove") {
            targetUser.role = "member";
            await targetUser.save();
            return sendMessage(senderId, `✅ SUCCESS\n${targetName} demoted to member.`);
        }
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
            const guide = `\n────────────────────\n💬 GUIDE:\n- Send messages, images, videos, or VM\n- Type 'quit' to end chat`;
            await sendMessage(senderId, `🎉 CONNECTED!\n────────────────────\nPartner: ${pData.name}${guide}`);
            await sendMessage(partner, `🎉 CONNECTED!\n────────────────────\nPartner: ${myData.name}${guide}`);
        } else {
            waitingQueue.push(senderId);
            await sendMessage(senderId, "🔍 SEARCHING...\n────────────────────\nLooking for a partner...");
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
    try { await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id }, message: { attachment: { type: type, payload: { url } } } }); } catch (e) {}
}

async function markSeen(id) {
    try { await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id }, sender_action: "mark_seen" }); } catch (e) {}
}

app.listen(PORT, () => console.log(`🚀 Bot Active on ${PORT}`));
