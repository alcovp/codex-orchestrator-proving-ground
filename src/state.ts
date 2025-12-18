import { EnemyManager } from "./enemies";
import type { Enemy, Point, Settings } from "./types";

export type StepResult =
  | {
      status: "alive";
      ateApple: boolean;
    }
  | {
      status: "dead";
      segments: Point[];
    };

export class SnakeGameState {
  snake: Point[] = [];
  apple: Point = { x: 0, y: 0 };
  direction: Point = { x: 1, y: 0 };
  private nextDirection: Point = { x: 1, y: 0 };
  score = 0;

  private readonly snakeSpeed: number;
  private readonly enemySpeed: number;
  private readonly snakeRadius = 0.45;
  private readonly enemyRadius = 0.4;
  private readonly appleRadius = 0.5;
  private readonly bodySampleStep = 0.5;
  private targetLength = 3;
  private currentLength = 0;
  private snakePath: Point[] = [];
  private readonly enemyManager: EnemyManager;

  constructor(private readonly settings: Settings) {
    this.snakeSpeed = 1000 / this.settings.tickMs;
    this.enemySpeed = this.snakeSpeed * 0.1;
    this.enemyManager = new EnemyManager(this.settings, this.enemySpeed);
    this.reset();
  }

  get enemies(): Enemy[] {
    return this.enemyManager.getAll();
  }

  reset(): void {
    const startX = Math.floor(this.settings.columns / 2);
    const startY = Math.floor(this.settings.rows / 2);
    this.direction = { x: 1, y: 0 };
    this.nextDirection = { x: 1, y: 0 };
    this.score = 0;
    this.targetLength = 3;
    this.enemyManager.reset();

    this.snakePath = [
      { x: startX, y: startY },
      { x: startX - 1, y: startY },
      { x: startX - 2, y: startY },
      { x: startX - 3, y: startY },
    ];
    this.currentLength = this.calculatePathLength();
    this.trimTail();
    const bodySamples = this.getBodySamples();
    this.apple = this.spawnApple(bodySamples);
    this.snake = this.getRenderableSegments();
  }

  tryChangeDirection(requested: Point): void {
    const magnitude = Math.hypot(requested.x, requested.y);
    if (magnitude === 0) {
      return;
    }
    const normalized = {
      x: requested.x / magnitude,
      y: requested.y / magnitude,
    };
    const reversing =
      normalized.x + this.direction.x === 0 &&
      normalized.y + this.direction.y === 0;
    if (reversing) {
      return;
    }
    this.nextDirection = normalized;
  }

  step(deltaSeconds: number): StepResult {
    if (deltaSeconds <= 0) {
      return { status: "alive", ateApple: false };
    }
    this.direction = this.nextDirection;

    this.moveSnake(deltaSeconds);

    const head = this.snakePath[0];
    if (!head) {
      this.reset();
      return { status: "alive", ateApple: false };
    }

    const renderSegments = this.getRenderableSegments();
    this.snake = renderSegments;

    if (this.isOutOfBounds(head) || this.collidesWithBody(head)) {
      return { status: "dead", segments: renderSegments };
    }

    const bodySamples = this.getBodySamples();

    const ateApple =
      this.distance(head, this.apple) <=
      this.appleRadius + this.snakeRadius * 0.5;
    if (ateApple) {
      this.score += 1;
      this.targetLength += 1;
      this.apple = this.spawnApple(bodySamples);
      this.enemyManager.trySpawn(this.score, bodySamples, this.apple);
    }

    this.enemyManager.tick(deltaSeconds, head, bodySamples);

    if (
      this.enemyManager.collidesWith(
        head,
        this.snakeRadius + this.enemyRadius,
      )
    ) {
      return { status: "dead", segments: renderSegments };
    }

    this.snake = renderSegments;

    return { status: "alive", ateApple };
  }

  private moveSnake(deltaSeconds: number): void {
    const head = this.snakePath[0];
    if (!head) {
      return;
    }
    const distance = this.snakeSpeed * deltaSeconds;
    if (distance <= 0) {
      return;
    }
    const newHead = {
      x: head.x + this.direction.x * distance,
      y: head.y + this.direction.y * distance,
    };
    this.snakePath.unshift(newHead);
    this.currentLength += distance;
    this.trimTail();
    this.cleanupPath();
  }

  private trimTail(): void {
    let excess = this.currentLength - this.targetLength;
    if (excess <= 0) {
      return;
    }
    while (excess > 0 && this.snakePath.length > 1) {
      const tail = this.snakePath[this.snakePath.length - 1];
      const beforeTail = this.snakePath[this.snakePath.length - 2];
      if (!tail || !beforeTail) {
        break;
      }
      const segLen = this.distance(beforeTail, tail);
      if (segLen <= excess + 1e-6) {
        this.snakePath.pop();
        excess -= segLen;
        this.currentLength -= segLen;
      } else {
        const ratio = segLen === 0 ? 0 : excess / segLen;
        tail.x += (beforeTail.x - tail.x) * ratio;
        tail.y += (beforeTail.y - tail.y) * ratio;
        this.currentLength -= excess;
        excess = 0;
      }
    }
    this.currentLength = this.targetLength;
  }

  private cleanupPath(): void {
    const minSegment = 0.01;
    for (let i = this.snakePath.length - 1; i > 0; i -= 1) {
      const curr = this.snakePath[i];
      const prev = this.snakePath[i - 1];
      if (!curr || !prev) {
        continue;
      }
      const segLen = this.distance(curr, prev);
      if (segLen < minSegment) {
        this.snakePath.splice(i, 1);
        this.currentLength = Math.max(0, this.currentLength - segLen);
      }
    }
  }

  private calculatePathLength(): number {
    let length = 0;
    for (let i = 0; i < this.snakePath.length - 1; i += 1) {
      const current = this.snakePath[i];
      const next = this.snakePath[i + 1];
      if (!current || !next) {
        continue;
      }
      length += this.distance(current, next);
    }
    return length;
  }

  private getRenderableSegments(): Point[] {
    return this.sampleAlongBody(1);
  }

  private getBodySamples(): Point[] {
    return this.sampleAlongBody(this.bodySampleStep);
  }

  private sampleAlongBody(step: number): Point[] {
    if (this.snakePath.length === 0) {
      return [];
    }
    const samples: Point[] = [];
    const pathLength = Math.max(this.currentLength, 0.0001);
    const desired = Math.max(
      2,
      Math.ceil(pathLength / Math.max(step, 0.01)) + 1,
    );
    let distanceFromHead = 0;
    let traversed = 0;
    let idx = 0;

    while (samples.length < desired && idx < this.snakePath.length - 1) {
      const start = this.snakePath[idx];
      const end = this.snakePath[idx + 1];
      if (!start || !end) {
        break;
      }
      const segLen = this.distance(start, end);
      while (
        distanceFromHead <= traversed + segLen &&
        samples.length < desired
      ) {
        const t = segLen === 0 ? 0 : (distanceFromHead - traversed) / segLen;
        const clampedT = Math.max(0, Math.min(1, t));
        samples.push({
          x: start.x + (end.x - start.x) * clampedT,
          y: start.y + (end.y - start.y) * clampedT,
        });
        distanceFromHead += step;
      }
      traversed += segLen;
      idx += 1;
    }
    const headPoint = this.snakePath[0];
    if (!headPoint) {
      samples.push({ x: 0, y: 0 });
    } else if (samples.length === 0) {
      samples.push({ x: headPoint.x, y: headPoint.y });
    } else {
      samples[0] = { x: headPoint.x, y: headPoint.y };
    }
    return samples;
  }

  private collidesWithBody(head: Point): boolean {
    let traveled = 0;
    for (let i = 1; i < this.snakePath.length; i += 1) {
      const a = this.snakePath[i - 1];
      const b = this.snakePath[i];
      if (!a || !b) {
        continue;
      }
      const segLen = this.distance(a, b);
      if (traveled > this.snakeRadius * 2) {
        const dist = this.distanceToSegment(head, a, b);
        if (dist < this.snakeRadius * 0.9) {
          return true;
        }
      }
      traveled += segLen;
    }
    return false;
  }

  private spawnApple(snakeSamples: Point[]): Point {
    const candidates: Point[] = [];
    for (let y = 0; y < this.settings.rows; y += 1) {
      for (let x = 0; x < this.settings.columns; x += 1) {
        const cell = { x, y };
        const nearSnake =
          this.distanceToPointSet(cell, snakeSamples) <
          this.snakeRadius + this.appleRadius;
        const nearEnemies =
          this.enemyManager.distanceToEnemies(cell) <
          this.enemyRadius + this.appleRadius;
        if (!nearSnake && !nearEnemies) {
          candidates.push(cell);
        }
      }
    }
    if (candidates.length === 0) {
      const fallback = this.snakePath[0];
      return fallback ? { x: fallback.x, y: fallback.y } : { x: 0, y: 0 };
    }
    const pick = Math.floor(Math.random() * candidates.length);
    const choice = candidates[pick] ?? candidates[0];
    if (!choice) {
      return { x: 0, y: 0 };
    }
    return { x: choice.x, y: choice.y };
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
      const d = this.distance(candidate, point);
      if (d < min) {
        min = d;
      }
    }
    return min;
  }

  private isOutOfBounds(point: Point): boolean {
    return (
      point.x < 0 ||
      point.y < 0 ||
      point.x > this.settings.columns - 1 ||
      point.y > this.settings.rows - 1
    );
  }

  private distance(a: Point, b: Point): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
  }

  private distanceToSegment(p: Point, a: Point, b: Point): number {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const apx = p.x - a.x;
    const apy = p.y - a.y;
    const abLenSq = abx * abx + aby * aby;
    if (abLenSq === 0) {
      return Math.hypot(apx, apy);
    }
    const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLenSq));
    const closest = { x: a.x + abx * t, y: a.y + aby * t };
    return this.distance(p, closest);
  }
}
