const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '500mb' }));
app.use(express.static('public'));

// --- POSTGRES DATABASE SETUP ---
// Awtomatikong kukunin ito ng Railway
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Helper
const getIp = (req) => req.headers['x-forwarded-for'] || req.socket.remoteAddress;

// Initialize Database Table in Postgres
const initDB = async () => {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS socn_data (id INT PRIMARY KEY, data JSONB)`);
        const res = await pool.query(`SELECT data FROM socn_data WHERE id = 1`);
        
        if (res.rowCount === 0) {
            const initialData = {
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
            await pool.query(`INSERT INTO socn_data (id, data) VALUES (1, $1)`, [initialData]);
            console.log("Database seeded successfully!");
        }
    } catch (err) {
        console.error("Database initialization error:", err);
    }
};
initDB();

const readDB = async () => {
    try {
        const res = await pool.query('SELECT data FROM socn_data WHERE id = 1');
        let db = res.rows[0].data;
        // Safety checks
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

const writeDB = async (data) => {
    await pool.query('UPDATE socn_data SET data = $1 WHERE id = 1', [data]);
};

// --- ROUTES (Now using async/await for Postgres) ---

app.get('/api/data', async (req, res) => res.json(await readDB()));

// Auth
app.post('/api/register', async (req, res) => {
    const db = await readDB();
    if (db.users.find(u => u.username === req.body.username)) return res.status(400).json({ error: "Username exists" });
    db.users.push({ username: req.body.username, password: req.body.password, role: 'user', ip: getIp(req), device: req.body.device, avatar: null, friends: [], notifications: [], isBanned: false });
    await writeDB(db);
    res.json({ success: true });
});

app.post('/api/login', async (req, res) => {
    const db = await readDB();
    const user = db.users.find(u => u.username === req.body.username && u.password === req.body.password);
    if (user) {
        if(user.isBanned) return res.status(403).json({ error: "ACCOUNT BANNED BY ADMIN." });
        user.ip = getIp(req);
        user.device = req.body.device || user.device;
        if(!user.friends) user.friends = [];
        if(!user.notifications) user.notifications = [];
        await writeDB(db);
        res.json({ success: true, user });
    } else {
        res.status(401).json({ error: "Invalid Login" });
    }
});

// Notifications & Friends Logic
app.post('/api/friend_action', async (req, res) => {
    const db = await readDB();
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
        await writeDB(db);
    }
    res.json(db);
});

// Posts & Reports
app.post('/api/post', async (req, res) => {
    const db = await readDB();
    db.posts.unshift({ ...req.body, id: Date.now().toString(), visibility: 'public', reactions: {}, comments: [] });
    await writeDB(db);
    res.json(db);
});
app.post('/api/delete_post', async (req, res) => {
    const db = await readDB();
    const index = db.posts.findIndex(p => p.id === req.body.postId);
    if (index !== -1) { db.posts.splice(index, 1); await writeDB(db); }
    res.json(db);
});
app.post('/api/edit_visibility', async (req, res) => {
    const db = await readDB();
    const post = db.posts.find(p => p.id === req.body.postId);
    if (post) { post.visibility = post.visibility === 'public' ? 'private' : 'public'; await writeDB(db); }
    res.json(db);
});
app.post('/api/report', async (req, res) => {
    const db = await readDB();
    if(!db.reports) db.reports = [];
    db.reports.push({ id: Date.now().toString(), postId: req.body.postId, reporter: req.body.username, reason: "Inappropriate Content", resolved: false });
    await writeDB(db);
    res.json(db);
});

// Admin Ban
app.post('/api/ban_user', async (req, res) => {
    const db = await readDB();
    const user = db.users.find(u => u.username === req.body.targetUser);
    if (user && user.role !== 'admin') {
        user.isBanned = !user.isBanned;
        await writeDB(db);
    }
    res.json(db);
});

// Interactions (Shorts, Reacts, Comments, Stories)
app.post('/api/short', async (req, res) => {
    const db = await readDB();
    if(!db.shorts) db.shorts = [];
    db.shorts.unshift({ ...req.body, id: Date.now().toString(), hearts: {}, favorites: {}, comments: [] });
    await writeDB(db);
    res.json(db);
});
app.post('/api/short_interact', async (req, res) => { const db = await readDB(); const short = db.shorts.find(s => s.id === req.body.shortId); if (short) { if (short[req.body.type][req.body.username]) delete short[req.body.type][req.body.username]; else short[req.body.type][req.body.username] = true; await writeDB(db); } res.json(db); });
app.post('/api/short_comment', async (req, res) => { const db = await readDB(); const short = db.shorts.find(s => s.id === req.body.shortId); if (short) { short.comments.push({ author: req.body.author, text: req.body.text }); await writeDB(db); } res.json(db); });
app.post('/api/update_avatar', async (req, res) => { const db = await readDB(); const user = db.users.find(u => u.username === req.body.username); if (user) { user.avatar = req.body.avatar; await writeDB(db); } res.json(db); });
app.post('/api/react', async (req, res) => { const db = await readDB(); const post = db.posts.find(p => p.id === req.body.postId); if (post) { if (post.reactions[req.body.username] === req.body.type) delete post.reactions[req.body.username]; else post.reactions[req.body.username] = req.body.type; await writeDB(db); } res.json(db); });
app.post('/api/comment', async (req, res) => { const db = await readDB(); const post = db.posts.find(p => p.id === req.body.postId); if (post) { post.comments.push({ author: req.body.author, text: req.body.text }); await writeDB(db); } res.json(db); });
app.post('/api/story', async (req, res) => { const db = await readDB(); db.stories.push({ ...req.body, id: Date.now().toString(), timestamp: Date.now() }); await writeDB(db); res.json(db); });
app.post('/api/message', async (req, res) => { const db = await readDB(); db.messages.push(req.body); await writeDB(db); res.json(db); });

// Start the server
const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => console.log(`Server running on port ${port}`));
