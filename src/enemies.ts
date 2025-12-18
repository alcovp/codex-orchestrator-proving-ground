import type { Enemy, Point, Settings } from "./types";

export class EnemyManager {
  private enemies: Enemy[] = [];
  private nextSpawnScore = 5;
  private readonly minSpawnDistance = 4;

  constructor(
    private readonly settings: Settings,
    private readonly speed: number,
  ) {}

  reset(): void {
    this.enemies = [];
    this.nextSpawnScore = 5;
  }

  getAll(): Enemy[] {
    return this.enemies;
  }

  collidesWith(point: Point, threshold: number): boolean {
    const thresholdSq = threshold * threshold;
    return this.enemies.some(
      (enemy) => this.distanceSq(enemy.position, point) <= thresholdSq,
    );
  }

  distanceToEnemies(point: Point): number {
    if (this.enemies.length === 0) {
      return Number.POSITIVE_INFINITY;
    }
    let min = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.enemies.length; i += 1) {
      const enemy = this.enemies[i];
      if (!enemy) {
        continue;
      }
      const dist = Math.sqrt(this.distanceSq(enemy.position, point));
      if (dist < min) {
        min = dist;
      }
    }
    return min;
  }

  trySpawn(score: number, snake: Point[], apple: Point): void {
    if (score < this.nextSpawnScore) {
      return;
    }
    this.spawnEnemy(snake, apple);
    this.nextSpawnScore += 5;
  }

  tick(deltaSeconds: number, target: Point, snake: Point[]): void {
    if (this.enemies.length === 0) {
      return;
    }
    const moved: Enemy[] = [];
    for (let i = 0; i < this.enemies.length; i += 1) {
      const enemy = this.enemies[i];
      if (!enemy) {
        continue;
      }
      const dirX = target.x - enemy.position.x;
      const dirY = target.y - enemy.position.y;
      const len = Math.hypot(dirX, dirY);
      if (len === 0) {
        moved.push(enemy);
        continue;
      }
      const step = Math.min(len, this.speed * deltaSeconds);
      const nx = enemy.position.x + (dirX / len) * step;
      const ny = enemy.position.y + (dirY / len) * step;
      const clamped = this.clampPosition({ x: nx, y: ny });
      moved.push({ position: clamped });
    }
    this.enemies = moved;
  }

  private spawnEnemy(snake: Point[], apple: Point): void {
    const freeCells: Point[] = [];
    for (let y = 0; y < this.settings.rows; y += 1) {
      for (let x = 0; x < this.settings.columns; x += 1) {
        const cell = { x, y };
        if (this.distanceToPointSet(cell, snake) <= 0.6) {
          continue;
        }
        if (this.distanceToEnemies(cell) <= 0.6) {
          continue;
        }
        if (this.samePoint(cell, apple)) {
          continue;
        }
        freeCells.push(cell);
      }
    }
    const safeCells = freeCells.filter(
      (cell) => this.distanceToPointSet(cell, snake) >= this.minSpawnDistance,
    );
    const pool = safeCells.length > 0 ? safeCells : freeCells;
    if (pool.length === 0) {
      return;
    }
    const pick = Math.floor(Math.random() * pool.length);
    const chosen = pool[pick] ?? pool[0];
    if (!chosen) {
      return;
    }
    this.enemies = [...this.enemies, { position: chosen }];
  }

  private distanceToPointSet(point: Point, set: Point[]): number {
    if (set.length === 0) {
      return Number.POSITIVE_INFINITY;
    }
    let min = Number.POSITIVE_INFINITY;
    for (let i = 0; i < set.length; i += 1) {
      const candidate = set[i];
      if (!candidate) {
        continue;
      }
      const dist = Math.sqrt(this.distanceSq(point, candidate));
      if (dist < min) {
        min = dist;
      }
    }
    return min;
  }

  private clampPosition(point: Point): Point {
    return {
      x: Math.min(
        Math.max(point.x, 0),
        Math.max(0, this.settings.columns - 1),
      ),
      y: Math.min(
        Math.max(point.y, 0),
        Math.max(0, this.settings.rows - 1),
      ),
    };
  }

  private distanceSq(a: Point, b: Point): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  }

  private samePoint(a: Point, b: Point): boolean {
    return a.x === b.x && a.y === b.y;
  }
}
