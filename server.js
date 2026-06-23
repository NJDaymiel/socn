const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '500mb' })); 
app.use(express.static('public'));

const dbDir = path.join(__dirname, 'database');
const dbFile = path.join(dbDir, 'db.json');

// Helper
const getIp = (req) => req.headers['x-forwarded-for'] || req.socket.remoteAddress;

// Initialize & Seed Database robustly
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir);
if (!fs.existsSync(dbFile)) {
    const initDB = { 
        users: [{ username: 'admin', password: '123', role: 'admin', ip: '127.0.0.1', device: 'System', avatar: null, friends: [], notifications: [], isBanned: false },
                { username: 'algo_bot', password: '123', role: 'user', ip: '127.0.0.1', device: 'Algorithm', avatar: null, friends: [], notifications: [], isBanned: false }], 
        posts: [
            { id: "101", author: "algo_bot", text: "Welcome to SocN! This is an algorithmic post.", visibility: "public", reactions: {}, comments: [] }
        ], 
        stories: [], messages: [], reports: [], 
        shorts: [
            { id: "201", author: "algo_bot", caption: "Nature Vibes 🌿", media: "https://www.w3schools.com/html/mov_bbb.mp4", hearts: {}, favorites: {}, comments: [] }
        ] 
    };
    fs.writeFileSync(dbFile, JSON.stringify(initDB, null, 2));
}

const readDB = () => {
    try {
        let db = JSON.parse(fs.readFileSync(dbFile, 'utf-8'));
        // Safety checks for all arrays
        if (!db.users) db.users = [];
        if (!db.posts) db.posts = [];
        if (!db.stories) db.stories = [];
        if (!db.messages) db.messages = [];
        if (!db.reports) db.reports = [];
        if (!db.shorts) db.shorts = [];
        return db;
    } catch(e) {
        return { users: [], posts: [], stories: [], messages: [], shorts: [], reports: [] };
    }
};
const writeDB = (data) => fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));

app.get('/api/data', (req, res) => res.json(readDB()));

// Auth
app.post('/api/register', (req, res) => {
    const db = readDB();
    if (db.users.find(u => u.username === req.body.username)) return res.status(400).json({ error: "Username exists" });
    db.users.push({ username: req.body.username, password: req.body.password, role: 'user', ip: getIp(req), device: req.body.device, avatar: null, friends: [], notifications: [], isBanned: false });
    writeDB(db);
    res.json({ success: true });
});

app.post('/api/login', (req, res) => {
    const db = readDB();
    const user = db.users.find(u => u.username === req.body.username && u.password === req.body.password);
    if (user) {
        if(user.isBanned) return res.status(403).json({ error: "ACCOUNT BANNED BY ADMIN." });
        user.ip = getIp(req); 
        user.device = req.body.device || user.device; 
        if(!user.friends) user.friends = []; 
        if(!user.notifications) user.notifications = [];
        writeDB(db);
        res.json({ success: true, user });
    } else {
        res.status(401).json({ error: "Invalid Login" });
    }
});

// Notifications & Friends Logic
app.post('/api/friend_action', (req, res) => {
    const db = readDB();
    const { from, to, action, notifId } = req.body;
    const uFrom = db.users.find(u => u.username === from);
    const uTo = db.users.find(u => u.username === to);
    
    if (uFrom && uTo) {
        if(!uTo.notifications) uTo.notifications = [];
        if(!uFrom.friends) uFrom.friends = [];
        if(!uTo.friends) uTo.friends = [];

        if (action === 'request') {
            const exists = uTo.notifications.find(n => n.type === 'friend_request' && n.from === from);
            if(!exists) uTo.notifications.push({ id: Date.now().toString(), type: 'friend_request', from, text: `${from} sent you a friend request!` });
        } else if (action === 'accept') {
            if(!uFrom.friends.includes(to)) uFrom.friends.push(to);
            if(!uTo.friends.includes(from)) uTo.friends.push(from);
            uFrom.notifications = uFrom.notifications.filter(n => n.id !== notifId);
        } else if (action === 'decline') {
            uFrom.notifications = uFrom.notifications.filter(n => n.id !== notifId);
        }
        writeDB(db);
    }
    res.json(db);
});

// Posts & Reports
app.post('/api/post', (req, res) => {
    const db = readDB();
    db.posts.unshift({ ...req.body, id: Date.now().toString(), visibility: 'public', reactions: {}, comments: [] });
    writeDB(db);
    res.json(db);
});
app.post('/api/delete_post', (req, res) => {
    const db = readDB();
    const index = db.posts.findIndex(p => p.id === req.body.postId);
    if (index !== -1) { db.posts.splice(index, 1); writeDB(db); }
    res.json(db);
});
app.post('/api/edit_visibility', (req, res) => {
    const db = readDB();
    const post = db.posts.find(p => p.id === req.body.postId);
    if (post) { post.visibility = post.visibility === 'public' ? 'private' : 'public'; writeDB(db); }
    res.json(db);
});
app.post('/api/report', (req, res) => {
    const db = readDB();
    if(!db.reports) db.reports = [];
    db.reports.push({ id: Date.now().toString(), postId: req.body.postId, reporter: req.body.username, reason: "Inappropriate Content", resolved: false });
    writeDB(db);
    res.json(db);
});

// Admin Ban
app.post('/api/ban_user', (req, res) => {
    const db = readDB();
    const user = db.users.find(u => u.username === req.body.targetUser);
    if (user && user.role !== 'admin') {
        user.isBanned = !user.isBanned;
        writeDB(db);
    }
    res.json(db);
});

// Interactions (Shorts, Reacts, Comments, Stories)
// CRITICAL FIX: Ensure db.shorts exists before unshift
app.post('/api/short', (req, res) => { 
    const db = readDB(); 
    if(!db.shorts) db.shorts = [];
    db.shorts.unshift({ ...req.body, id: Date.now().toString(), hearts: {}, favorites: {}, comments: [] }); 
    writeDB(db); 
    res.json(db); 
});
app.post('/api/short_interact', (req, res) => { const db = readDB(); const short = db.shorts.find(s => s.id === req.body.shortId); if (short) { if (short[req.body.type][req.body.username]) delete short[req.body.type][req.body.username]; else short[req.body.type][req.body.username] = true; writeDB(db); } res.json(db); });
app.post('/api/short_comment', (req, res) => { const db = readDB(); const short = db.shorts.find(s => s.id === req.body.shortId); if (short) { short.comments.push({ author: req.body.author, text: req.body.text }); writeDB(db); } res.json(db); });
app.post('/api/update_avatar', (req, res) => { const db = readDB(); const user = db.users.find(u => u.username === req.body.username); if (user) { user.avatar = req.body.avatar; writeDB(db); } res.json(db); });
app.post('/api/react', (req, res) => { const db = readDB(); const post = db.posts.find(p => p.id === req.body.postId); if (post) { if (post.reactions[req.body.username] === req.body.type) delete post.reactions[req.body.username]; else post.reactions[req.body.username] = req.body.type; writeDB(db); } res.json(db); });
app.post('/api/comment', (req, res) => { const db = readDB(); const post = db.posts.find(p => p.id === req.body.postId); if (post) { post.comments.push({ author: req.body.author, text: req.body.text }); writeDB(db); } res.json(db); });
app.post('/api/story', (req, res) => { const db = readDB(); db.stories.push({ ...req.body, id: Date.now().toString(), timestamp: Date.now() }); writeDB(db); res.json(db); });
app.post('/api/message', (req, res) => { const db = readDB(); db.messages.push(req.body); writeDB(db); res.json(db); });

app.listen(3000, '0.0.0.0', () => console.log(`Server running on http://0.0.0.0:3000`));
