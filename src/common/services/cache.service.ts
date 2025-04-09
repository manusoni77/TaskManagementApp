// cache.service.ts
import { Injectable, Inject, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly namespace = 'app'; // optional key prefix

  constructor(@Inject(CACHE_MANAGER) private readonly cacheManager: Cache) {}

  private buildKey(key: string): string {
    return `${this.namespace}:${key}`;
  }

  async get<T>(key: string): Promise<T | null> {
    const namespacedKey = this.buildKey(key);
    const cached = await this.cacheManager.get<string>(namespacedKey);

    if (!cached) {
      this.logger.debug(`Cache MISS: ${namespacedKey}`);
      return null;
    }

    this.logger.debug(`Cache HIT: ${namespacedKey}`);
    try {
      return JSON.parse(cached) as T;
    } catch {
      return cached as unknown as T;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds = 300): Promise<void> {
    const namespacedKey = this.buildKey(key);
    const data = typeof value === 'string' ? value : JSON.stringify(value);

    try {
      await this.cacheManager.set(namespacedKey, data, ttlSeconds);
      this.logger.debug(`Cache SET: ${namespacedKey} (TTL: ${ttlSeconds}s)`);
    } catch (err) {
      this.logger.error(`Cache SET ERROR: ${namespacedKey}`, err);
    }
  }

  async delete(key: string): Promise<void> {
    const namespacedKey = this.buildKey(key);
    await this.cacheManager.del(namespacedKey);
    this.logger.debug(`Cache DELETE: ${namespacedKey}`);
  }

  async clear(): Promise<void> {
    const redisCache = this.cacheManager as any;
    if (typeof redisCache.reset === 'function') {
      await redisCache.reset();
      this.logger.warn('Cache CLEARED: All keys removed');
    } else {
      this.logger.error('reset() not supported by this cache store');
      throw new Error('Cache store does not support reset()');
    }
  }

  async getOrSet<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttlSeconds = 300
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    this.logger.debug(`Cache POPULATE: ${key}`);
    const value = await fetcher();
    await this.set(key, value, ttlSeconds);
    return value;
  }

  async has(key: string): Promise<boolean> {
    const value = await this.get(key);
    return value !== null;
  }
}
