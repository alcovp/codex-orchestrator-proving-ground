import type { Point, Settings } from "./types";

export type StepResult = {
  reset: boolean;
  ateApple: boolean;
};

export class SnakeGameState {
  snake: Point[] = [];
  apple: Point = { x: 0, y: 0 };
  direction: Point = { x: 1, y: 0 };
  private nextDirection: Point = { x: 1, y: 0 };

  constructor(private readonly settings: Settings) {
    this.reset();
  }

  reset(): void {
    const startX = Math.floor(this.settings.columns / 2);
    const startY = Math.floor(this.settings.rows / 2);
    this.direction = { x: 1, y: 0 };
    this.nextDirection = { x: 1, y: 0 };
    this.snake = [
      { x: startX, y: startY },
      { x: startX - 1, y: startY },
      { x: startX - 2, y: startY },
    ];
    this.apple = this.spawnApple();
  }

  tryChangeDirection(requested: Point): void {
    const reversing =
      requested.x + this.direction.x === 0 &&
      requested.y + this.direction.y === 0;
    if (reversing) {
      return;
    }
    this.nextDirection = requested;
  }

  step(): StepResult {
    this.direction = this.nextDirection;
    const head = this.snake[0];
    if (!head) {
      this.reset();
      return { reset: true, ateApple: false };
    }
    const newHead: Point = {
      x: head.x + this.direction.x,
      y: head.y + this.direction.y,
    };

    if (this.isOutOfBounds(newHead) || this.isOnSnake(newHead)) {
      this.reset();
      return { reset: true, ateApple: false };
    }

    const ateApple = newHead.x === this.apple.x && newHead.y === this.apple.y;
    this.snake = [newHead, ...this.snake];
    if (!ateApple) {
      this.snake.pop();
    } else {
      this.apple = this.spawnApple();
    }

    return { reset: false, ateApple };
  }

  private spawnApple(): Point {
    const freeCells: Point[] = [];
    for (let y = 0; y < this.settings.rows; y += 1) {
      for (let x = 0; x < this.settings.columns; x += 1) {
        const cell = { x, y };
        if (!this.isOnSnake(cell)) {
          freeCells.push(cell);
        }
      }
    }
    if (freeCells.length === 0) {
      return this.snake[0] ?? { x: 0, y: 0 };
    }
    const pick = Math.floor(Math.random() * freeCells.length);
    const appleCell = freeCells[pick];
    if (appleCell) {
      return appleCell;
    }
    return freeCells[0] ?? { x: 0, y: 0 };
  }

  private isOnSnake(point: Point): boolean {
    return this.snake.some(
      (segment) => segment.x === point.x && segment.y === point.y,
    );
  }

  private isOutOfBounds(point: Point): boolean {
    return (
      point.x < 0 ||
      point.y < 0 ||
      point.x >= this.settings.columns ||
      point.y >= this.settings.rows
    );
  }
}
