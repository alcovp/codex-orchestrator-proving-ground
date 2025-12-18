import * as THREE from "three";
import * as CANNON from "cannon-es";
import type { Point, Settings } from "./types";

type SceneApi = {
  render(): void;
  updateSnake(segments: Point[]): void;
  updateApple(position: Point): void;
  updateScore(score: number): void;
  startExplosion(segments: Point[]): void;
  stopExplosion(): void;
  resize(): void;
};

export function createScene3D(
  canvas: HTMLCanvasElement,
  settings: Settings,
): SceneApi {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#0b0f16");

  const renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.autoClear = false;
  if (scene.background instanceof THREE.Color) {
    renderer.setClearColor(scene.background);
  }

  const boardWidth = settings.columns * settings.cellSize;
  const boardDepth = settings.rows * settings.cellSize;
  const halfWidth = boardWidth / 2;
  const halfDepth = boardDepth / 2;
  const boardCenter = new THREE.Vector3(0, settings.cellSize * 0.2, 0);

  const cameraRange = Math.max(boardWidth, boardDepth);
  const camera = new THREE.PerspectiveCamera(
    55,
    canvas.clientWidth / canvas.clientHeight,
    0.1,
    cameraRange * 4,
  );
  camera.position.set(cameraRange * 0.6, cameraRange * 0.9, cameraRange * 0.65);
  camera.lookAt(boardCenter);
  scene.add(camera);

  const ambient = new THREE.HemisphereLight(0xb9d4ff, 0x0d1623, 0.35);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.05);
  keyLight.position.set(boardWidth * 0.35, cameraRange * 1.2, boardDepth * 0.35);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  const shadowRange = cameraRange;
  keyLight.shadow.camera.near = 1;
  keyLight.shadow.camera.far = shadowRange * 2;
  keyLight.shadow.camera.left = -shadowRange;
  keyLight.shadow.camera.right = shadowRange;
  keyLight.shadow.camera.top = shadowRange;
  keyLight.shadow.camera.bottom = -shadowRange;
  keyLight.target.position.copy(boardCenter);
  scene.add(keyLight);
  scene.add(keyLight.target);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(
      boardWidth + settings.cellSize * 4,
      boardDepth + settings.cellSize * 4,
    ),
    new THREE.MeshStandardMaterial({
      color: "#0d1117",
      roughness: 0.92,
      metalness: 0.08,
    }),
  );
  floor.receiveShadow = true;
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const grid = new THREE.GridHelper(
    boardWidth,
    settings.columns,
    0x233146,
    0x1d2738,
  );
  grid.position.y = 0.01;
  scene.add(grid);

  const hudScene = new THREE.Scene();
  const hudCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);

  const hudCanvas = document.createElement("canvas");
  hudCanvas.width = 1024;
  hudCanvas.height = 256;
  const hudContext = (() => {
    const context = hudCanvas.getContext("2d");
    if (!context) {
      throw new Error("Не удалось создать контекст HUD");
    }
    return context;
  })();
  const hudTexture = new THREE.CanvasTexture(hudCanvas);
  hudTexture.minFilter = THREE.LinearFilter;
  hudTexture.magFilter = THREE.LinearFilter;
  hudTexture.needsUpdate = true;

  const hudMaterial = new THREE.MeshBasicMaterial({
    map: hudTexture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const hudGeometry = new THREE.PlaneGeometry(1, 1);
  const hudPlane = new THREE.Mesh(hudGeometry, hudMaterial);
  hudPlane.position.set(0, 0.8, 0);
  hudScene.add(hudPlane);

  let currentScore = 0;

  function drawRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ): void {
    const clampedRadius = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + clampedRadius, y);
    ctx.lineTo(x + width - clampedRadius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + clampedRadius);
    ctx.lineTo(x + width, y + height - clampedRadius);
    ctx.quadraticCurveTo(
      x + width,
      y + height,
      x + width - clampedRadius,
      y + height,
    );
    ctx.lineTo(x + clampedRadius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - clampedRadius);
    ctx.lineTo(x, y + clampedRadius);
    ctx.quadraticCurveTo(x, y, x + clampedRadius, y);
    ctx.closePath();
  }

  function paintHud(score: number): void {
    currentScore = score;
    const w = hudCanvas.width;
    const h = hudCanvas.height;
    hudContext.clearRect(0, 0, w, h);

    const panelGradient = hudContext.createLinearGradient(0, 0, w, 0);
    panelGradient.addColorStop(0, "rgba(42, 70, 110, 0.9)");
    panelGradient.addColorStop(1, "rgba(26, 34, 52, 0.92)");

    drawRoundedRect(hudContext, 26, 32, w - 52, h - 64, 28);
    hudContext.fillStyle = panelGradient;
    hudContext.fill();

    hudContext.shadowColor = "rgba(12, 219, 126, 0.25)";
    hudContext.shadowBlur = 24;
    drawRoundedRect(hudContext, 34, 40, w - 68, h - 80, 24);
    hudContext.fillStyle = "rgba(14, 220, 126, 0.07)";
    hudContext.fill();
    hudContext.shadowBlur = 0;

    hudContext.fillStyle = "rgba(255, 255, 255, 0.08)";
    hudContext.fillRect(34, h * 0.42, w - 68, 2);

    hudContext.fillStyle = "#e4edff";
    hudContext.font = "700 72px 'Segoe UI', system-ui, sans-serif";
    hudContext.textBaseline = "middle";
    hudContext.textAlign = "left";
    hudContext.fillText("Змейка", 64, h * 0.35);

    const scoreLabel = `Счёт: ${score}`;
    hudContext.fillStyle = "#86f5a3";
    hudContext.font = "700 96px 'Segoe UI', system-ui, sans-serif";
    hudContext.textAlign = "right";
    hudContext.fillText(scoreLabel, w - 72, h * 0.65);

    hudContext.fillStyle = "rgba(216, 227, 245, 0.78)";
    hudContext.font = "400 38px 'Segoe UI', system-ui, sans-serif";
    hudContext.textAlign = "left";
    hudContext.fillText("Управление: стрелки", 64, h - 64);

    hudTexture.needsUpdate = true;
  }

  function updateScore(score: number): void {
    paintHud(score);
  }

  const world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -30, 0),
  });
  world.broadphase = new CANNON.NaiveBroadphase();
  if (world.solver instanceof CANNON.GSSolver) {
    world.solver.iterations = 10;
  }

  const segmentMaterial = new CANNON.Material("segment");
  const floorMaterial = new CANNON.Material("floor");
  world.addContactMaterial(
    new CANNON.ContactMaterial(segmentMaterial, floorMaterial, {
      friction: 0.45,
      restitution: 0.28,
    }),
  );

  const floorBody = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Plane(),
    material: floorMaterial,
  });
  floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(floorBody);

  const snakeGeometry = new THREE.BoxGeometry(
    settings.cellSize * 0.9,
    settings.cellSize * 0.9,
    settings.cellSize * 0.9,
  );
  const snakeBodyMaterial = new THREE.MeshStandardMaterial({
    color: "#4ade80",
    roughness: 0.3,
    metalness: 0.08,
  });
  const snakeHeadMaterial = new THREE.MeshStandardMaterial({
    color: "#22c55e",
    emissive: "#1f5c3d",
    emissiveIntensity: 0.35,
    roughness: 0.25,
    metalness: 0.12,
  });
  const snakeMeshes: THREE.Mesh[] = [];
  const segmentHalfExtent = settings.cellSize * 0.45;
  const segmentShape = new CANNON.Box(
    new CANNON.Vec3(
      segmentHalfExtent,
      segmentHalfExtent,
      segmentHalfExtent,
    ),
  );
  let explosionBodies: CANNON.Body[] = [];
  let explosionActive = false;
  let lastPhysicsStep = performance.now();

  const appleMesh = new THREE.Mesh(
    new THREE.SphereGeometry(settings.cellSize * 0.4, 28, 18),
    new THREE.MeshStandardMaterial({
      color: "#f43f5e",
      emissive: "#431018",
      emissiveIntensity: 0.5,
      metalness: 0.25,
      roughness: 0.3,
    }),
  );
  appleMesh.castShadow = true;
  scene.add(appleMesh);

  function cellToWorld(point: Point): THREE.Vector3 {
    return new THREE.Vector3(
      -halfWidth + settings.cellSize * 0.5 + point.x * settings.cellSize,
      settings.cellSize * 0.5,
      -halfDepth + settings.cellSize * 0.5 + point.y * settings.cellSize,
    );
  }

  function updateSnake(segments: Point[]): void {
    while (snakeMeshes.length < segments.length) {
      const mesh = new THREE.Mesh(snakeGeometry, snakeBodyMaterial);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      snakeMeshes.push(mesh);
    }
    while (snakeMeshes.length > segments.length) {
      const mesh = snakeMeshes.pop();
      if (mesh) {
        scene.remove(mesh);
      }
    }
    for (let i = 0; i < segments.length; i += 1) {
      const mesh = snakeMeshes[i];
      const segment = segments[i];
      if (!mesh || !segment) {
        continue;
      }
      const world = cellToWorld(segment);
      mesh.quaternion.identity();
      mesh.position.copy(world);
      mesh.material = i === 0 ? snakeHeadMaterial : snakeBodyMaterial;
    }
  }

  function updateApple(position: Point): void {
    const world = cellToWorld(position);
    appleMesh.position.set(world.x, settings.cellSize * 0.55, world.z);
  }

  function startExplosion(segments: Point[]): void {
    updateSnake(segments);
    explosionBodies.forEach((body) => world.removeBody(body));
    explosionBodies = [];
    explosionActive = true;
    lastPhysicsStep = performance.now();

    for (let i = 0; i < segments.length; i += 1) {
      const mesh = snakeMeshes[i];
      if (!mesh) {
        continue;
      }
      const body = new CANNON.Body({
        mass: 0.6,
        shape: segmentShape,
        position: new CANNON.Vec3(
          mesh.position.x,
          mesh.position.y,
          mesh.position.z,
        ),
        material: segmentMaterial,
      });
      body.linearDamping = 0.12;
      body.angularDamping = 0.18;
      const angle = Math.random() * Math.PI * 2;
      const speed = settings.cellSize * (2.5 + Math.random() * 3.5);
      const upward = settings.cellSize * (2.2 + Math.random() * 1.2);
      body.velocity.set(
        Math.cos(angle) * speed,
        upward,
        Math.sin(angle) * speed,
      );
      body.angularVelocity.set(
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10,
      );
      world.addBody(body);
      explosionBodies.push(body);
    }
  }

  function stopExplosion(): void {
    explosionBodies.forEach((body) => world.removeBody(body));
    explosionBodies = [];
    explosionActive = false;
    snakeMeshes.forEach((mesh) => {
      mesh.quaternion.identity();
    });
  }

  function resize(): void {
    const width = canvas.clientWidth || canvas.width;
    const height = canvas.clientHeight || canvas.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const needResize =
      canvas.width !== Math.floor(width * dpr) ||
      canvas.height !== Math.floor(height * dpr);
    if (needResize) {
      renderer.setSize(width, height, false);
    }
    renderer.setPixelRatio(dpr);
    const aspect = height > 0 ? width / height : 1;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();

    const hudDpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetHudWidth = Math.floor(1024 * hudDpr);
    const targetHudHeight = Math.floor(256 * hudDpr);
    if (
      hudCanvas.width !== targetHudWidth ||
      hudCanvas.height !== targetHudHeight
    ) {
      hudCanvas.width = targetHudWidth;
      hudCanvas.height = targetHudHeight;
      paintHud(currentScore);
    }

    hudCamera.left = -aspect;
    hudCamera.right = aspect;
    hudCamera.top = 1;
    hudCamera.bottom = -1;
    hudCamera.updateProjectionMatrix();

    const hudWidth = Math.min(aspect * 1.6, 1.8);
    const hudHeight = hudWidth * (hudCanvas.height / hudCanvas.width);
    hudPlane.scale.set(hudWidth, hudHeight, 1);
    hudPlane.position.set(0, 1 - hudHeight * 0.65, 0);
  }

  function render(): void {
    resize();
    const now = performance.now();
    const deltaSeconds = (now - lastPhysicsStep) / 1000;
    lastPhysicsStep = now;
    if (explosionActive) {
      world.step(1 / 60, deltaSeconds, 5);
      for (let i = 0; i < explosionBodies.length; i += 1) {
        const body = explosionBodies[i];
        const mesh = snakeMeshes[i];
        if (!mesh || !body) {
          continue;
        }
        mesh.position.set(
          body.position.x,
          body.position.y,
          body.position.z,
        );
        mesh.quaternion.set(
          body.quaternion.x,
          body.quaternion.y,
          body.quaternion.z,
          body.quaternion.w,
        );
      }
    }
    renderer.clear();
    renderer.render(scene, camera);
    renderer.clearDepth();
    renderer.render(hudScene, hudCamera);
  }

  return {
    render,
    updateSnake,
    updateApple,
    updateScore,
    startExplosion,
    stopExplosion,
    resize,
  };
}
