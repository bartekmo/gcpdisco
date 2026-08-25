import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import Redis from 'ioredis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const redis = new Redis(
    process.env.REDIS_PORT || 6379,
    process.env.REDIS_HOST || 'redis'
);

// Getters - read the data indexed into Redis by the app/ batch job.

function getIdentities() {
    return redis.smembers('idx:identities');
}

function getServices(identity) {
    return redis.smembers(`idx:services:${identity}`);
}

async function getEntitlements(member, service) {
    function enrichEntitlement(ent) {
        return {
            ...ent,
            sourceCount: ent.source.length
        };
    }
    const ids = await redis.smembers(`idx:member:${member}:service:${service}`);
    if (ids.length === 0) return [];
    const pipeline = redis.pipeline();
    ids.forEach(id => pipeline.call('JSON.GET', `entitlements:${id}`));
    const results = await pipeline.exec();
    return results
        .filter(([err, val]) => !err && val)
        .map(([, val]) => JSON.parse(val))
        .map(enrichEntitlement);
}

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/identities', async (req, res) => {
    try {
        res.json(await getIdentities());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/services/:identity', async (req, res) => {
    try {
        res.json(await getServices(req.params.identity));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/entitlements/:identity/:service', async (req, res) => {
    try {
        res.json(await getEntitlements(req.params.identity, req.params.service));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Web app listening on port ${PORT}`);
});
