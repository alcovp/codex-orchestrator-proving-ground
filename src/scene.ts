import * as THREE from "three";
import type {
  BuildingState,
  GameWorld,
  MapDefinition,
  Selection,
  UnitState,
  WorldSettings,
} from "./types";

export type WorldScene = {
  setMap(map: MapDefinition): void;
  render(): void;
  resize(): void;
  setInputEnabled(enabled: boolean): void;
  updateWorld(world: GameWorld, selection: Selection | null): void;
  pick(screenX: number, screenY: number): Selection | null;
  dispose(): void;
};

export function createWorldScene(
  canvas: HTMLCanvasElement,
  settings: WorldSettings,
): WorldScene {
  const scene = new THREE.Scene();
  const backgroundColor = new THREE.Color("#0c0a08");
  scene.background = backgroundColor;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const camera = new THREE.PerspectiveCamera(
    55,
    canvas.clientWidth / Math.max(1, canvas.clientHeight),
    0.1,
    500,
  );
  scene.add(camera);

  const ambient = new THREE.HemisphereLight(0xffe3b5, 0x3a2412, 0.7);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xfff4da, 1.05);
  sun.position.set(120, 160, 60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 340;
  sun.shadow.camera.left = -180;
  sun.shadow.camera.right = 180;
  sun.shadow.camera.top = 180;
  sun.shadow.camera.bottom = -180;
  scene.add(sun);

  let terrain: THREE.Mesh | null = null;
  let grid: THREE.LineSegments | null = null;
  let currentMap: MapDefinition | null = null;
  let mapHalfWidth = 0;
  let mapHalfHeight = 0;
  let resourceGroup: THREE.Group | null = null;
  let startGroup: THREE.Group | null = null;

  const cameraTarget = new THREE.Vector3();
  const desiredTarget = new THREE.Vector3();
  const tilt = THREE.MathUtils.degToRad(settings.camera.tiltDeg);
  let distance = settings.camera.defaultDistance;
  let targetDistance = settings.camera.defaultDistance;
  let lastFrame = performance.now();
  const moveDirection = new THREE.Vector2();
  const inputState = {
    pointer: new THREE.Vector2(),
    pointerInside: false,
    keys: new Set<string>(),
    enabled: true,
  };

  function buildTerrain(map: MapDefinition): void {
    if (terrain) {
      terrain.geometry.dispose();
      if (terrain.material instanceof THREE.Material) {
        terrain.material.dispose();
      }
      scene.remove(terrain);
      terrain = null;
    }
    if (grid) {
      grid.geometry.dispose();
      if (grid.material instanceof THREE.Material) {
        grid.material.dispose();
      }
      scene.remove(grid);
      grid = null;
    }

    const geometry = new THREE.PlaneGeometry(map.size.width, map.size.height, 1, 1);
    const material = new THREE.MeshStandardMaterial({
      color: settings.terrain.baseColor,
      roughness: 0.86,
      metalness: 0.08,
    });
    terrain = new THREE.Mesh(geometry, material);
    terrain.receiveShadow = true;
    terrain.rotation.x = -Math.PI / 2;
    scene.add(terrain);

    const gridSegments = Math.max(
      4,
      Math.round(Math.max(map.size.width, map.size.height) / Math.max(1, map.tileSize)),
    );
    const helper = new THREE.GridHelper(
      Math.max(map.size.width, map.size.height),
      gridSegments,
      new THREE.Color(settings.terrain.accentColor),
      new THREE.Color(settings.terrain.accentColor),
    );
    const helperMaterials = Array.isArray(helper.material)
      ? helper.material
      : [helper.material];
    helperMaterials.forEach((material) => {
      material.transparent = true;
      material.opacity = settings.terrain.gridOpacity;
      material.depthWrite = false;
    });
    helper.position.y = 0.02;
    grid = helper;
    scene.add(helper);

    mapHalfWidth = Math.max(0, map.size.width / 2 - settings.camera.boundsPadding);
    mapHalfHeight = Math.max(0, map.size.height / 2 - settings.camera.boundsPadding);

    desiredTarget.set(0, 0, 0);
    cameraTarget.copy(desiredTarget);
    const fogNear = Math.max(map.size.width, map.size.height) * 0.45;
    const fogFar = fogNear * 2.3;
    scene.fog = new THREE.Fog(backgroundColor, fogNear, fogFar);
    currentMap = map;
  }

  function clampTarget(target: THREE.Vector3): void {
    if (!currentMap) {
      return;
    }
    const maxX = Math.max(0, mapHalfWidth);
    const maxZ = Math.max(0, mapHalfHeight);
    target.x = THREE.MathUtils.clamp(target.x, -maxX, maxX);
    target.z = THREE.MathUtils.clamp(target.z, -maxZ, maxZ);
  }

  function disposeGroup(group: THREE.Group | null): void {
    if (!group) {
      return;
    }
    group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((mat) => mat.dispose());
        } else if (obj.material instanceof THREE.Material) {
          obj.material.dispose();
        }
      }
    });
    scene.remove(group);
  }

  function buildResourceSpots(map: MapDefinition): void {
    disposeGroup(resourceGroup);
    resourceGroup = new THREE.Group();
    map.resources.forEach((spot) => {
      const radius = Math.max(0.8, spot.radius);
      const height = Math.max(0.6, 0.6 + (spot.richness - 1) * 0.4);
      const cylinder = new THREE.CylinderGeometry(radius * 0.75, radius, height, 12, 1);
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0xc98e43),
        emissive: new THREE.Color(0x5c320d),
        roughness: 0.64,
        metalness: 0.02,
      });
      const mesh = new THREE.Mesh(cylinder, material);
      mesh.position.set(spot.position.x, height / 2, spot.position.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      resourceGroup?.add(mesh);

      const ringGeometry = new THREE.RingGeometry(
        Math.max(0.2, radius * 0.55),
        radius * 0.95,
        32,
      );
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: new THREE.Color(0xffd78b),
        transparent: true,
        opacity: 0.38,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(spot.position.x, 0.04, spot.position.z);
      resourceGroup?.add(ring);
    });
    scene.add(resourceGroup);
  }

  function buildStartLocations(map: MapDefinition): void {
    disposeGroup(startGroup);
    startGroup = new THREE.Group();
    map.startLocations.forEach((loc, index) => {
      const padRadius = 4;
      const padGeometry = new THREE.CylinderGeometry(padRadius, padRadius, 0.3, 24);
      const padMaterial = new THREE.MeshStandardMaterial({
        color: index === 0 ? 0x89f0ff : 0xf0b589,
        emissive: index === 0 ? 0x0f6f86 : 0x744419,
        roughness: 0.62,
        metalness: 0.12,
      });
      const pad = new THREE.Mesh(padGeometry, padMaterial);
      pad.position.set(loc.position.x, 0.15, loc.position.z);
      pad.receiveShadow = true;
      startGroup?.add(pad);

      const arrowGeometry = new THREE.ConeGeometry(1.2, 3, 12);
      const arrowMaterial = new THREE.MeshStandardMaterial({
        color: 0xf5e6c8,
        emissive: 0x5a4728,
        roughness: 0.4,
        metalness: 0.18,
      });
      const arrow = new THREE.Mesh(arrowGeometry, arrowMaterial);
      arrow.position.set(loc.position.x, 2.2, loc.position.z);
      arrow.rotation.y = THREE.MathUtils.degToRad(loc.facingDeg ?? 0);
      arrow.castShadow = true;
      startGroup?.add(arrow);
    });
    scene.add(startGroup);
  }

  function isMoveKey(code: string): boolean {
    return (
      code === "KeyW" ||
      code === "KeyA" ||
      code === "KeyS" ||
      code === "KeyD" ||
      code === "ArrowUp" ||
      code === "ArrowDown" ||
      code === "ArrowLeft" ||
      code === "ArrowRight"
    );
  }

  function computeMoveDirection(): THREE.Vector2 {
    moveDirection.set(0, 0);
    if (!inputState.enabled || !currentMap) {
      return moveDirection;
    }

    if (inputState.keys.has("KeyA") || inputState.keys.has("ArrowLeft")) {
      moveDirection.x -= 1;
    }
    if (inputState.keys.has("KeyD") || inputState.keys.has("ArrowRight")) {
      moveDirection.x += 1;
    }
    if (inputState.keys.has("KeyW") || inputState.keys.has("ArrowUp")) {
      moveDirection.y -= 1;
    }
    if (inputState.keys.has("KeyS") || inputState.keys.has("ArrowDown")) {
      moveDirection.y += 1;
    }

    if (inputState.pointerInside) {
      const margin = settings.camera.edgeThreshold;
      const width = Math.max(1, window.innerWidth);
      const height = Math.max(1, window.innerHeight);
      const px = inputState.pointer.x;
      const py = inputState.pointer.y;
      if (px <= margin) {
        moveDirection.x -= 1 - px / margin;
      } else if (px >= width - margin) {
        moveDirection.x += 1 - (width - px) / margin;
      }
      if (py <= margin) {
        moveDirection.y -= 1 - py / margin;
      } else if (py >= height - margin) {
        moveDirection.y += 1 - (height - py) / margin;
      }
    }

    return moveDirection;
  }

  function applyMovement(deltaSeconds: number): void {
    if (!currentMap || !inputState.enabled) {
      return;
    }
    const direction = computeMoveDirection();
    if (direction.lengthSq() > 1) {
      direction.normalize();
    }
    if (direction.lengthSq() === 0) {
      return;
    }
    const speed = settings.camera.panSpeed;
    desiredTarget.x += direction.x * speed * deltaSeconds;
    desiredTarget.z += direction.y * speed * deltaSeconds;
    clampTarget(desiredTarget);
  }

  function updateCamera(deltaSeconds: number): void {
    const zoomLerp = 1 - Math.exp(-deltaSeconds * settings.camera.zoomSmoothing);
    distance += (targetDistance - distance) * zoomLerp;
    distance = THREE.MathUtils.clamp(
      distance,
      settings.camera.minDistance,
      settings.camera.maxDistance,
    );
    const panLerp = 1 - Math.exp(-deltaSeconds * settings.camera.panSmoothing);
    if (panLerp > 0) {
      cameraTarget.lerp(desiredTarget, panLerp);
    } else {
      cameraTarget.copy(desiredTarget);
    }
    clampTarget(cameraTarget);

    const horizontal = Math.cos(tilt) * distance;
    const vertical = Math.sin(tilt) * distance;
    camera.position.set(
      cameraTarget.x,
      cameraTarget.y + vertical,
      cameraTarget.z + horizontal,
    );
    camera.lookAt(cameraTarget);
  }

  function resize(): void {
    const width = canvas.clientWidth || canvas.width;
    const height = canvas.clientHeight || canvas.height || 1;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (
      canvas.width !== Math.floor(width * dpr) ||
      canvas.height !== Math.floor(height * dpr)
    ) {
      renderer.setSize(width, height, false);
    }
    renderer.setPixelRatio(dpr);
    camera.aspect = Math.max(1e-4, width / height);
    camera.updateProjectionMatrix();
  }

  function render(): void {
    resize();
    const now = performance.now();
    const deltaSeconds = Math.min((now - lastFrame) / 1000, 0.2);
    lastFrame = now;
    applyMovement(deltaSeconds);
    updateCamera(deltaSeconds);
    renderer.render(scene, camera);
  }

  function onWheel(event: WheelEvent): void {
    if (!inputState.enabled) {
      return;
    }
    event.preventDefault();
    const zoomStep = event.deltaY * 0.01;
    targetDistance = THREE.MathUtils.clamp(
      targetDistance + zoomStep,
      settings.camera.minDistance,
      settings.camera.maxDistance,
    );
  }

  function onPointerMove(event: PointerEvent): void {
    inputState.pointer.set(event.clientX, event.clientY);
    inputState.pointerInside = true;
  }

  function onPointerLeave(): void {
    inputState.pointerInside = false;
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (!isMoveKey(event.code) || !inputState.enabled) {
      return;
    }
    inputState.keys.add(event.code);
    event.preventDefault();
  }

  function onKeyUp(event: KeyboardEvent): void {
    if (!isMoveKey(event.code) || !inputState.enabled) {
      return;
    }
    inputState.keys.delete(event.code);
    event.preventDefault();
  }

  function onWindowBlur(): void {
    inputState.keys.clear();
  }

  function setInputEnabled(enabled: boolean): void {
    inputState.enabled = enabled;
    if (!enabled) {
      inputState.keys.clear();
    }
  }

  function setMap(map: MapDefinition): void {
    buildTerrain(map);
    buildResourceSpots(map);
    buildStartLocations(map);
    targetDistance = settings.camera.defaultDistance;
    distance = targetDistance;
  }

  canvas.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerleave", onPointerLeave);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onWindowBlur);

  return {
    setMap,
    render,
    resize,
    setInputEnabled,
    dispose: () => {
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onWindowBlur);
      renderer.dispose();
      disposeGroup(resourceGroup);
      disposeGroup(startGroup);
      resourceGroup = null;
      startGroup = null;
      if (terrain) {
        terrain.geometry.dispose();
        if (terrain.material instanceof THREE.Material) {
          terrain.material.dispose();
        }
      }
      if (grid) {
        grid.geometry.dispose();
        if (grid.material instanceof THREE.Material) {
          grid.material.dispose();
        }
      }
    },
  };
}
