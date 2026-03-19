// backend/src/services/redis.js — Redis client with graceful degradation
import Redis from 'ioredis';

let redis;

function getRedis() {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      lazyConnect: true,
      enableOfflineQueue: false,   // fail-fast — don't block alert pipeline
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => Math.min(times * 200, 5000),
    });

    redis.on('connect', () => console.log('✅ Redis connected'));
    redis.on('error', (err) => {
      // Non-fatal — system falls back to in-memory caches
      if (process.env.NODE_ENV !== 'test') {
        console.warn('⚠️  Redis error (non-fatal):', err.message);
      }
    });
  }
  return redis;
}

export default getRedis();
