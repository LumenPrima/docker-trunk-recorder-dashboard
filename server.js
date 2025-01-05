require('dotenv').config();
const express = require('express');
const http = require('http');
const { MongoClient } = require('mongodb');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');

// Validate required environment variables
if (!process.env.MONGODB_URI) {
    console.error('ERROR: MONGODB_URI environment variable is required');
    process.exit(1);
}

const app = express();

// Enable CORS for all routes
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Serve socket.io client
app.get('/socket.io/socket.io.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'node_modules/socket.io/client-dist/socket.io.js'));
});

const MONGO_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'trunk_recorder';
const COLLECTION_NAME = process.env.COLLECTION_NAME || 'radio_events';

// Initialize talkgroup data
const talkgroupsMap = new Map();
const unknownTalkgroups = new Set();
let talkgroupFile = process.env.TALKGROUP_FILE || 'talkgroups.csv';

// Function to save talkgroup data
async function saveTalkgroups() {
    if (!talkgroupFile) return;

    try {
        // Prepare CSV content
        const header = 'decimal,hex,alphaTag,mode,description,tag,category';
        const lines = [];

        // Add known talkgroups
        for (const [decimal, data] of talkgroupsMap.entries()) {
            const line = [
                decimal,
                data.hex || '',
                data.alphaTag || `Talkgroup ${decimal}`,
                data.mode || '',
                data.description || '',
                data.tag || 'Unknown',
                data.category || 'Unknown'
            ].map(field => `"${field}"`).join(',');
            lines.push(line);
        }

        // Add unknown talkgroups
        for (const decimal of unknownTalkgroups) {
            if (!talkgroupsMap.has(decimal)) {
                const line = [
                    decimal,
                    '',
                    `Talkgroup ${decimal}`,
                    '',
                    '',
                    'Unknown',
                    'Unknown'
                ].map(field => `"${field}"`).join(',');
                lines.push(line);
            }
        }

        // Write to file
        const content = [header, ...lines].join('\n');
        await fs.promises.writeFile(talkgroupFile, content, 'utf-8');
        console.log(`Saved ${lines.length} talkgroups to ${talkgroupFile}`);
    } catch (error) {
        console.error('Error saving talkgroup file:', error);
    }
}

// Load talkgroup data
try {
    if (fs.existsSync(talkgroupFile)) {
        console.log(`Loading talkgroup data from ${talkgroupFile}`);
        const csvContent = fs.readFileSync(talkgroupFile, 'utf-8');
        const csvLines = csvContent
            .split('\n')
            .filter(line => line.trim() && !line.startsWith('#')); // Skip comments and empty lines

        // Find the header line
        const headerIndex = csvLines.findIndex(line => {
            const lowerLine = line.toLowerCase();
            return lowerLine.includes('decimal') && 
                   (lowerLine.includes('alphatag') || lowerLine.includes('alpha tag'));
        });
        
        if (headerIndex === -1) {
            console.error('Error: CSV file must have a header with at least "decimal" and "alphaTag" columns');
        } else {
            const dataLines = csvLines.slice(headerIndex + 1);
            dataLines.forEach(line => {
                if (line.trim()) {
                    const [decimal, hex, alphaTag, mode, description, tag, category] = line.split(',').map(field => field.replace(/"/g, ''));
                    talkgroupsMap.set(decimal, {
                        hex: hex?.trim() || '',
                        alphaTag: alphaTag?.trim() || `Talkgroup ${decimal}`,
                        mode: mode?.trim() || '',
                        description: description?.trim() || '',
                        tag: tag?.trim() || 'Unknown',
                        category: category?.trim() || 'Unknown'
                    });
                }
            });
            console.log(`Loaded ${talkgroupsMap.size} talkgroups`);
        }
    } else {
        console.log('No talkgroup file found, will create one as talkgroups are discovered');
        talkgroupFile = 'talkgroups.csv';
    }
} catch (error) {
    console.error('Error loading talkgroup file:', error);
    console.log('Will create new file as talkgroups are discovered');
    talkgroupFile = 'talkgroups.csv';
}

// Save talkgroups periodically (every hour)
setInterval(saveTalkgroups, 60 * 60 * 1000);

// Endpoint to get talkgroup metadata
app.get('/api/talkgroups', (req, res) => {
    const talkgroupsObject = Object.fromEntries(talkgroupsMap);
    res.json({
        talkgroups: talkgroupsObject,
        unknownTalkgroups: Array.from(unknownTalkgroups)
    });
});

// IMPORTANT: This endpoint must come before the :decimal endpoint to prevent route conflicts
app.post('/api/talkgroups/reload', async (req, res) => {
    try {
        if (fs.existsSync(talkgroupFile)) {
            // Clear existing data
            talkgroupsMap.clear();
            unknownTalkgroups.clear();

            console.log(`Reloading talkgroup data from ${talkgroupFile}`);
            const csvContent = fs.readFileSync(talkgroupFile, 'utf-8');
            console.log('CSV file size:', csvContent.length, 'bytes');
            const csvLines = csvContent
                .split('\n')
                .filter(line => line.trim() && !line.startsWith('#')); // Skip comments and empty lines
            
            console.log('Total lines after filtering:', csvLines.length);

            // Find the header line
            const headerIndex = csvLines.findIndex(line => {
                console.log('Checking line for header:', line);
                const lowerLine = line.toLowerCase();
                return lowerLine.includes('decimal') && 
                       (lowerLine.includes('alphatag') || lowerLine.includes('alpha tag'));
            });
            
            console.log('Header index:', headerIndex);
            
            if (headerIndex === -1) {
                throw new Error('CSV file must have a header with at least "decimal" and "alphaTag" columns');
            }

            const dataLines = csvLines.slice(headerIndex + 1);
            console.log('Data lines to process:', dataLines.length);
            dataLines.forEach(line => {
                if (line.trim()) {
                    const [decimal, hex, alphaTag, mode, description, tag, category] = line.split(',').map(field => field.replace(/"/g, ''));
                    talkgroupsMap.set(decimal, {
                        hex: hex?.trim() || '',
                        alphaTag: alphaTag?.trim() || `Talkgroup ${decimal}`,
                        mode: mode?.trim() || '',
                        description: description?.trim() || '',
                        tag: tag?.trim() || 'Unknown',
                        category: category?.trim() || 'Unknown'
                    });
                }
            });
            console.log(`Reloaded ${talkgroupsMap.size} talkgroups`);
            res.json({ status: 'success', message: `Reloaded ${talkgroupsMap.size} talkgroups` });
        } else {
            throw new Error('Talkgroup file not found');
        }
    } catch (error) {
        console.error('Error reloading talkgroup file:', error);
        res.status(500).json({ error: 'Failed to reload talkgroups: ' + error.message });
    }
});

// Endpoint to update talkgroup metadata
app.post('/api/talkgroups/:decimal', express.json(), async (req, res) => {
    const decimal = req.params.decimal;
    const metadata = req.body;

    // Validate required fields
    if (!metadata.alphaTag) {
        return res.status(400).json({ error: 'alphaTag is required' });
    }

    // Update talkgroup data
    talkgroupsMap.set(decimal, {
        hex: metadata.hex || '',
        alphaTag: metadata.alphaTag,
        mode: metadata.mode || '',
        description: metadata.description || '',
        tag: metadata.tag || 'Unknown',
        category: metadata.category || 'Unknown'
    });

    // Remove from unknown list if present
    unknownTalkgroups.delete(decimal);

    // Save changes
    await saveTalkgroups();

    res.json({ status: 'success', message: 'Talkgroup updated' });
});

// Endpoint to get talkgroup-specific history
app.get('/api/talkgroup/:id/history', async (req, res) => {
    try {
        const client = new MongoClient(MONGO_URI);
        await client.connect();
        const db = client.db(DB_NAME);
        const collection = db.collection(COLLECTION_NAME);

        const talkgroupId = req.params.id;
        // Get last 24 hours of events for this talkgroup
        const startTime = new Date(Date.now() - 24 * 60 * 60 * 1000)
            .toISOString()
            .replace(/\.\d{3}Z$/, 'Z');

        // First get the most recent 200 records
        const recentEvents = await collection
            .find({
                talkgroupOrSource: talkgroupId
            })
            .sort({ timestamp: -1 })
            .limit(200)
            .toArray();

        // Then get events from last 24 hours
        const dayEvents = await collection
            .find({
                talkgroupOrSource: talkgroupId,
                timestamp: { $gte: startTime }
            })
            .sort({ timestamp: -1 })
            .toArray();

        // Use whichever result set is smaller
        const events = recentEvents.length <= dayEvents.length ? recentEvents : dayEvents;

        // Add metadata to events
        events.forEach(event => {
            const talkgroupInfo = talkgroupsMap.get(event.talkgroupOrSource?.toString());
            if (talkgroupInfo) {
                event.talkgroupInfo = talkgroupInfo;
            }
        });

        // Get unique radios that have been affiliated
        const uniqueRadios = [...new Set(events.map(event => event.radioID))];

        res.json({
            talkgroupId,
            totalEvents: events.length,
            uniqueRadios,
            events: events
        });
        await client.close();
    } catch (error) {
        console.error('Error fetching talkgroup history:', error);
        res.status(500).json({ error: 'Failed to fetch talkgroup history' });
    }
});

// Endpoint to get historical events
app.get('/api/history/:duration', async (req, res) => {
    try {
        const client = new MongoClient(MONGO_URI);
        await client.connect();
        const db = client.db(DB_NAME);
        const collection = db.collection(COLLECTION_NAME);

        let minutes;
        const duration = req.params.duration;
        if (duration === '30m') {
            minutes = 30;
        } else if (duration === '2h') {
            minutes = 120;
        } else if (duration === '6h') {
            minutes = 360;
        } else if (duration === '12h') {
            minutes = 720;
        } else {
            throw new Error(`Invalid duration parameter: ${duration}`);
        }

        const startTime = new Date(Date.now() - minutes * 60 * 1000)
            .toISOString()
            .replace(/\.\d{3}Z$/, 'Z'); // Remove milliseconds to match log_mongo.sh format
        
        const events = await collection
            .find({
                timestamp: { $gte: startTime },
                eventType: { $nin: ['location'] }
            })
            .sort({ timestamp: 1 })
            .toArray();

        // Add metadata to events
        events.forEach(event => {
            const talkgroupInfo = talkgroupsMap.get(event.talkgroupOrSource?.toString());
            if (talkgroupInfo) {
                event.talkgroupInfo = talkgroupInfo;
            }
        });

        res.json({
            duration: minutes,
            totalEvents: events.length,
            events: events
        });
        await client.close();
    } catch (error) {
        console.error('Error fetching history:', error);
        res.status(500).json({ error: 'Failed to fetch history' });
    }
});

// Serve static files
app.use(express.static('public'));

// Connect to MongoDB and set up change stream
async function connectToMongo() {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);

    let messageCount = 0;
    
    // Setup periodic status reporting
    setInterval(() => {
        console.log(`[Status] Processed ${messageCount} messages in the last 30 seconds`);
        messageCount = 0; // Reset counter
    }, 30000);

    const changeStream = collection.watch();
    
    changeStream.on('change', (change) => {
        if (change.operationType === 'insert') {
            const event = change.fullDocument;
            messageCount++;

            // Track unknown talkgroups
            const talkgroupId = event.talkgroupOrSource?.toString();
            if (talkgroupId && !talkgroupsMap.has(talkgroupId)) {
                unknownTalkgroups.add(talkgroupId);
            }

            // Add talkgroup metadata to the event
            const talkgroupInfo = talkgroupsMap.get(talkgroupId);
            if (talkgroupInfo) {
                event.talkgroupInfo = talkgroupInfo;
            }
            io.emit('radioEvent', event);
        }
    });

    changeStream.on('error', (error) => {
        console.error('Change stream error:', error);
    });

    changeStream.on('close', () => {
        console.log('Change stream closed');
    });
}

connectToMongo().catch(console.error);

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
