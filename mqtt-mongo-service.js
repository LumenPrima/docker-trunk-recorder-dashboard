#!/usr/bin/env node
const mqtt = require('mqtt');
const { MongoClient } = require('mongodb');
require('dotenv').config();

// Configuration
const MQTT_BROKER = process.env.MQTT_BROKER || 'mqtt://localhost:1883';
const MQTT_TOPIC_PREFIX = process.env.MQTT_TOPIC_PREFIX || 'topic';
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'trunk_recorder';
const COLLECTION_NAME = process.env.COLLECTION_NAME || 'radio_events';
const DEDUPE_WINDOW = 5; // 5 seconds, matching previous service

if (!MONGODB_URI) {
  console.error('ERROR: MONGODB_URI environment variable is required');
  process.exit(1);
}

class MongoService {
  constructor() {
    this.client = null;
    this.collection = null;
    this.dedupeCache = new Map();
  }

  async connect() {
    try {
      this.client = new MongoClient(MONGODB_URI, {
        connectTimeoutMS: 5000,
        socketTimeoutMS: 30000,
        maxPoolSize: 10
      });
      
      await this.client.connect();
      this.collection = this.client.db(DB_NAME).collection(COLLECTION_NAME);
      console.log('Connected to MongoDB');
      return true;
    } catch (err) {
      console.error('MongoDB connection error:', err);
      return false;
    }
  }

  async handleEvent(event) {
    const cacheKey = `${event.shortName}-${event.radioID}-${event.eventType}-${event.talkgroupOrSource}`;
    
    // Check deduplication cache
    if (this.dedupeCache.has(cacheKey)) {
      return { status: 'skipped', message: 'Duplicate event within time window' };
    }

    try {
      // Add to dedupe cache with timeout
      this.dedupeCache.set(cacheKey, true);
      setTimeout(() => this.dedupeCache.delete(cacheKey), DEDUPE_WINDOW * 1000);

      // Format timestamp to match previous format (without milliseconds)
      const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
      
      // Insert the event
      const doc = {
        ...event,
        timestamp,
        talkgroupOrSource: event.talkgroupOrSource?.toString()
      };

      await this.collection.insertOne(doc);
      return { status: 'success', message: 'Event logged successfully' };
    } catch (err) {
      console.error('Error logging event:', err);
      return { status: 'error', message: err.message };
    }
  }

  async close() {
    if (this.client) {
      await this.client.close();
      console.log('MongoDB connection closed');
    }
  }
}

class MqttService {
  constructor(mongoService) {
    this.mongoService = mongoService;
    this.client = null;
  }

  connect() {
    console.log(`Connecting to MQTT broker at ${MQTT_BROKER}...`);
    this.client = mqtt.connect(MQTT_BROKER);

    this.client.on('connect', () => {
      console.log('Connected to MQTT broker');
      
      // Subscribe to relevant topics
      const topics = [
        '/call_start',
        '/call_end',
        '/calls_active',
        '/recorder',
        '/recorders',
        '/rates'
      ];
      
      topics.forEach(topic => {
        this.client.subscribe(topic, (err) => {
          if (err) {
            console.error(`Error subscribing to ${topic}:`, err);
          } else {
            console.log(`Subscribed to ${topic}`);
          }
        });
      });
    });

    this.client.on('message', async (topic, message) => {
      try {
        const data = JSON.parse(message.toString());
        
        // Extract relevant data based on message type
        let event;
        if (data.type === 'call_start' || data.type === 'call_end') {
          const call = data.call;
          event = {
            // Core identifiers
            shortName: data.instance_id,
            radioID: call.unit,
            eventType: data.type,
            talkgroupOrSource: call.talkgroup,
            
            // Unit information
            unit_alpha_tag: call.unit_alpha_tag,
            
            // Talkgroup information
            talkgroup_alpha_tag: call.talkgroup_alpha_tag,
            talkgroup_description: call.talkgroup_description,
            talkgroup_group: call.talkgroup_group,
            talkgroup_tag: call.talkgroup_tag,
            talkgroup_patches: call.talkgroup_patches || '',
            
            // Technical details
            frequency: call.freq,
            audio_type: call.audio_type,
            phase2: call.phase2_tdma,
            tdma_slot: call.tdma_slot,
            encrypted: call.encrypted,
            emergency: call.emergency,
            
            // Call state
            call_state: call.call_state,
            call_state_type: call.call_state_type,
            mon_state: call.mon_state,
            mon_state_type: call.mon_state_type,
            
            // Quality metrics
            error_count: call.error_count,
            spike_count: call.spike_count,
            signal: call.signal,
            noise: call.noise,
            
            // File information (for call_end)
            call_filename: call.call_filename,
            
            // Timing
            start_time: call.start_time,
            stop_time: call.stop_time,
            timestamp: new Date(data.timestamp * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
          };
        }
        // Add more message type handlers as needed

        if (event) {
          await this.mongoService.handleEvent(event);
        }
      } catch (err) {
        console.error('Error processing MQTT message:', err);
      }
    });

    this.client.on('error', (err) => {
      console.error('MQTT client error:', err);
    });

    this.client.on('close', () => {
      console.log('MQTT connection closed');
    });
  }

  async close() {
    if (this.client) {
      this.client.end();
      console.log('MQTT connection closed');
    }
  }
}

// Handle shutdown
async function shutdown() {
  console.log('\nShutting down...');
  if (mqttService) await mqttService.close();
  if (mongoService) await mongoService.close();
  process.exit();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start services
let mongoService, mqttService;

(async () => {
  mongoService = new MongoService();
  const connected = await mongoService.connect();
  if (!connected) {
    process.exit(1);
  }

  mqttService = new MqttService(mongoService);
  mqttService.connect();
})();
