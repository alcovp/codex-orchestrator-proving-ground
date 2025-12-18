import type { Enemy, Point, Settings } from "./types";

export class EnemyManager {
  private enemies: Enemy[] = [];
  private nextSpawnScore = 5;
  private moveCooldown: number;
  private readonly moveInterval: number;
  private readonly minSpawnDistance = 4;

  constructor(private readonly settings: Settings, moveIntervalTicks = 10) {
    this.moveInterval = moveIntervalTicks;
    this.moveCooldown = moveIntervalTicks;
  }

  reset(): void {
    this.enemies = [];
    this.nextSpawnScore = 5;
    this.moveCooldown = this.moveInterval;
  }

  getAll(): Enemy[] {
    return this.enemies;
  }

  isOnEnemy(point: Point): boolean {
    return this.enemies.some(
      (enemy) =>
        enemy.position.x === point.x && enemy.position.y === point.y,
    );
  }

  trySpawn(score: number, snake: Point[], apple: Point): void {
    if (score < this.nextSpawnScore) {
      return;
    }
    this.spawnEnemy(snake, apple);
    this.nextSpawnScore += 5;
  }

  tick(snakeHead: Point | undefined, snake: Point[]): void {
    this.moveCooldown -= 1;
    if (this.moveCooldown > 0) {
      return;
    }
    this.moveCooldown = this.moveInterval;
    if (!snakeHead || this.enemies.length === 0) {
      return;
    }
    this.moveEnemiesToward(snakeHead, snake);
  }

  private spawnEnemy(snake: Point[], apple: Point): void {
    const freeCells: Point[] = [];
    for (let y = 0; y < this.settings.rows; y += 1) {
      for (let x = 0; x < this.settings.columns; x += 1) {
        const cell = { x, y };
        if (
          !this.containsPoint(snake, cell) &&
          !this.isOnEnemy(cell) &&
          !this.samePoint(cell, apple)
        ) {
          freeCells.push(cell);
        }
      }
    }
    const safeCells = freeCells.filter(
      (cell) =>
        this.minDistanceToSnake(cell, snake) >= this.minSpawnDistance,
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

  private moveEnemiesToward(target: Point, snake: Point[]): void {
    const moved: Enemy[] = [];
    for (let i = 0; i < this.enemies.length; i += 1) {
      const enemy = this.enemies[i];
      if (!enemy) {
        continue;
      }
      const next = this.findNextStep(enemy.position, target, snake);
      moved.push({ position: next ?? enemy.position });
    }
    this.enemies = moved;
  }

  private findNextStep(
    start: Point,
    target: Point,
    snake: Point[],
  ): Point | null {
    if (start.x === target.x && start.y === target.y) {
      return start;
    }
    const queue: Point[] = [start];
    const visited = new Set<string>([this.key(start)]);
    const parent = new Map<string, string>();
    const blocked = this.buildBlockedSet(snake, start);

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        break;
      }
      const neighbors = this.getNeighbors(current);
      for (let i = 0; i < neighbors.length; i += 1) {
        const neighbor = neighbors[i];
        if (!neighbor) {
          continue;
        }
        const key = this.key(neighbor);
        const isTarget = this.samePoint(neighbor, target);
        if (!isTarget && (blocked.has(key) || visited.has(key))) {
          continue;
        }
        if (isTarget) {
          parent.set(key, this.key(current));
          return this.reconstructNextStep(parent, start, neighbor);
        }
        visited.add(key);
        parent.set(key, this.key(current));
        queue.push(neighbor);
      }
    }
    return null;
  }

  private reconstructNextStep(
    parent: Map<string, string>,
    start: Point,
    target: Point,
  ): Point | null {
    const startKey = this.key(start);
    let currentKey: string = this.key(target);
    let previousKey: string | undefined = parent.get(currentKey);
    while (previousKey && previousKey !== startKey) {
      currentKey = previousKey;
      previousKey = parent.get(currentKey);
    }
    if (!previousKey) {
      return null;
    }
    return this.pointFromKey(currentKey);
  }

  private buildBlockedSet(snake: Point[], selfPosition: Point): Set<string> {
    const blocked = new Set<string>();
    for (let i = 0; i < snake.length; i += 1) {
      const segment = snake[i];
      if (segment) {
        blocked.add(this.key(segment));
      }
    }
    for (let i = 0; i < this.enemies.length; i += 1) {
      const enemy = this.enemies[i];
      if (!enemy) {
        continue;
      }
      if (this.samePoint(enemy.position, selfPosition)) {
        continue;
      }
      blocked.add(this.key(enemy.position));
    }
    return blocked;
  }

  private getNeighbors(point: Point): Point[] {
    const candidates: Point[] = [
      { x: point.x + 1, y: point.y },
      { x: point.x - 1, y: point.y },
      { x: point.x, y: point.y + 1 },
      { x: point.x, y: point.y - 1 },
    ];
    return candidates.filter((candidate) => !this.isOutOfBounds(candidate));
  }

  private isOutOfBounds(point: Point): boolean {
    return (
      point.x < 0 ||
      point.y < 0 ||
      point.x >= this.settings.columns ||
      point.y >= this.settings.rows
    );
  }

  private key(point: Point): string {
    return `${point.x},${point.y}`;
  }

  private pointFromKey(key: string): Point | null {
    const [xStr, yStr] = key.split(",");
    if (xStr === undefined || yStr === undefined) {
      return null;
    }
    const x = Number.parseInt(xStr, 10);
    const y = Number.parseInt(yStr, 10);
    if (Number.isNaN(x) || Number.isNaN(y)) {
      return null;
    }
    return { x, y };
  }

  private containsPoint(collection: Point[], point: Point): boolean {
    return collection.some(
      (item) => item.x === point.x && item.y === point.y,
    );
  }

  private samePoint(a: Point, b: Point): boolean {
    return a.x === b.x && a.y === b.y;
  }

  private minDistanceToSnake(point: Point, snake: Point[]): number {
    let min = Number.POSITIVE_INFINITY;
    for (let i = 0; i < snake.length; i += 1) {
      const segment = snake[i];
      if (!segment) {
        continue;
      }
      const d = this.manhattanDistance(point, segment);
      if (d < min) {
        min = d;
      }
    }
    return min;
  }

  private manhattanDistance(a: Point, b: Point): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }
}
