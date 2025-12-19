import * as THREE from "three";
import type {
  BuildingDefinition,
  BuildingState,
  BuildingTypeId,
  FactionId,
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
  setCameraSensitivity(multiplier: number): void;
  updateWorld(world: GameWorld, selection: Selection | null): void;
  pick(screenX: number, screenY: number): Selection | null;
  pickInRect(rect: DOMRect): Selection | null;
  projectToGround(screenX: number, screenY: number): { x: number; z: number } | null;
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
  const resourceMeshes = new Map<
    string,
    { body: THREE.Mesh; ring: THREE.Mesh; maxAmount: number }
  >();
  const buildingMeshes = new Map<string, EntityMeshEntry>();
  const unitMeshes = new Map<string, EntityMeshEntry>();
  let fogMesh: THREE.Mesh | null = null;
  let fogTexture: THREE.DataTexture | null = null;
  let fogData: Uint8Array | null = null;
  let fogWidth = 0;
  let fogHeight = 0;
  const pickTargets: THREE.Object3D[] = [];
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const groundPoint = new THREE.Vector3();
  const factionTint: Record<FactionId, THREE.ColorRepresentation> = {
    player: 0x76d4ff,
    ai: 0xff8f76,
  };
  const factionAccent: Record<FactionId, THREE.ColorRepresentation> = {
    player: 0x1c6bb0,
    ai: 0x8c2d1e,
  };

  type HealthBarInstance = {
    group: THREE.Group;
    fill: THREE.Mesh;
    bg: THREE.Mesh;
    width: number;
    offsetY: number;
  };

  type EntityMeshEntry = {
    group: THREE.Group;
    body: THREE.Mesh;
    ring: THREE.Mesh;
    health: HealthBarInstance;
    hover: THREE.Group;
  };

  const healthTempQuat = new THREE.Quaternion();
  const healthParentQuat = new THREE.Quaternion();
  let hoverSelection: Selection | null = null;

  const cameraTarget = new THREE.Vector3();
  const desiredTarget = new THREE.Vector3();
  const tilt = THREE.MathUtils.degToRad(settings.camera.tiltDeg);
  let distance = settings.camera.defaultDistance;
  let targetDistance = settings.camera.defaultDistance;
  let panSpeed = settings.camera.panSpeed;
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

  function disposeFog(): void {
    if (fogMesh) {
      if (fogMesh.material instanceof THREE.Material) {
        fogMesh.material.dispose();
      }
      fogMesh.geometry.dispose();
      scene.remove(fogMesh);
    }
    if (fogTexture) {
      fogTexture.dispose();
    }
    fogMesh = null;
    fogTexture = null;
    fogData = null;
    fogWidth = 0;
    fogHeight = 0;
  }

  function buildResourceSpots(map: MapDefinition): void {
    disposeGroup(resourceGroup);
    resourceMeshes.clear();
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
      material.transparent = true;
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

      const resourceId = `node-${spot.id}`;
      resourceMeshes.set(resourceId, { body: mesh, ring, maxAmount: 0 });
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

  function createSelectionRing(
    radius: number,
    color: THREE.ColorRepresentation,
  ): THREE.Mesh {
    const geometry = new THREE.RingGeometry(Math.max(0.6, radius * 0.45), radius, 48);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.38,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.05;
    return mesh;
  }

  function createHealthBar(owner: FactionId, width: number, offsetY: number): HealthBarInstance {
    const group = new THREE.Group();
    group.position.y = offsetY;
    group.renderOrder = 5;

    const bgMaterial = new THREE.MeshBasicMaterial({
      color: 0x1c1914,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      depthTest: false,
    });
    const fillMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(factionTint[owner]),
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      depthTest: false,
    });

    const bg = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), bgMaterial);
    bg.scale.set(width + 0.14, 0.2, 1);
    bg.position.z = 0.001;
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), fillMaterial);
    fill.scale.set(width, 0.12, 1);
    fill.position.z = 0.002;
    group.add(bg);
    group.add(fill);

    return { group, fill, bg, width, offsetY };
  }

  function updateHealthBar(bar: HealthBarInstance, ratio: number): void {
    const clamped = THREE.MathUtils.clamp(ratio, 0, 1);
    bar.fill.scale.x = bar.width * clamped;
    bar.fill.position.x = (clamped - 1) * (bar.width * 0.5);
  }

  function faceCamera(bar: HealthBarInstance, parent: THREE.Group): void {
    parent.getWorldQuaternion(healthParentQuat);
    healthParentQuat.invert();
    healthTempQuat.copy(camera.quaternion);
    bar.group.quaternion.copy(healthParentQuat.multiply(healthTempQuat));
  }

  function createHoverOutline(meshes: THREE.Mesh[], owner: FactionId): THREE.Group {
    const group = new THREE.Group();
    meshes.forEach((mesh) => {
      const outlineMaterial = new THREE.MeshBasicMaterial({
        color: new THREE.Color(factionTint[owner]),
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      });
      const geom = mesh.geometry.clone();
      const clone = new THREE.Mesh(geom, outlineMaterial);
      clone.position.copy(mesh.position);
      clone.rotation.copy(mesh.rotation);
      clone.scale.copy(mesh.scale).multiplyScalar(1.1);
      clone.renderOrder = 6;
      group.add(clone);
    });
    group.visible = false;
    return group;
  }

  function setHover(selection: Selection | null): void {
    hoverSelection = selection;
    buildingMeshes.forEach((entry, id) => {
      entry.hover.visible =
        !!selection &&
        selection.kind === "building" &&
        selection.id === id &&
        entry.group.visible;
    });
    unitMeshes.forEach((entry, id) => {
      entry.hover.visible =
        !!selection && selection.kind === "unit" && selection.id === id && entry.group.visible;
    });
  }

  function disposeEntityMesh(entry: EntityMeshEntry): void {
    entry.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((mat) => mat.dispose());
        } else if (obj.material instanceof THREE.Material) {
          obj.material.dispose();
        }
      }
    });
    scene.remove(entry.group);
  }

  function makeBuildingMesh(building: BuildingState, def: BuildingDefinition): EntityMeshEntry {
    const group = new THREE.Group();
    const baseRadius = def.size * 0.5;
    const bodyGeometry = new THREE.CylinderGeometry(
      baseRadius * 0.88,
      baseRadius,
      Math.max(2.4, def.size * 0.4),
      12,
      1,
    );
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color(factionTint[building.owner]),
      emissive: new THREE.Color(factionAccent[building.owner]),
      roughness: 0.48,
      metalness: 0.22,
    });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.castShadow = true;
    body.receiveShadow = true;
    body.userData.selection = { kind: "building", id: building.id };
    group.add(body);

    const capGeometry = new THREE.ConeGeometry(baseRadius * 0.45, 2.2, 10);
    const capMaterial = new THREE.MeshStandardMaterial({
      color: 0xf1e4cf,
      emissive: new THREE.Color(factionAccent[building.owner]),
      roughness: 0.32,
      metalness: 0.3,
    });
    const cap = new THREE.Mesh(capGeometry, capMaterial);
    cap.position.y = Math.max(1.6, def.size * 0.2);
    cap.rotation.y = THREE.MathUtils.degToRad(building.facingDeg + 25);
    cap.castShadow = true;
    cap.receiveShadow = true;
    cap.userData.selection = { kind: "building", id: building.id };
    group.add(cap);

    const ring = createSelectionRing(baseRadius * 0.95, factionTint[building.owner]);
    group.add(ring);

    const barWidth = Math.max(2.4, def.size * 0.6);
    const barOffset = Math.max(3, def.size * 0.45 + 1.4);
    const health = createHealthBar(building.owner, barWidth, barOffset);
    group.add(health.group);

    const hover = createHoverOutline([body, cap], building.owner);
    group.add(hover);

    group.position.set(building.position.x, 0, building.position.z);
    group.rotation.y = THREE.MathUtils.degToRad(building.facingDeg);
    return { group, ring, body, health, hover };
  }

  function makeUnitMesh(unit: UnitState): EntityMeshEntry {
    const group = new THREE.Group();
    const isWorker = unit.typeId === "worker";
    const bodyRadiusTop = isWorker ? 0.6 : 0.75;
    const bodyRadiusBottom = isWorker ? 0.65 : 0.85;
    const bodyHeight = isWorker ? 1.5 : 1.95;
    const bodyGeometry = new THREE.CylinderGeometry(bodyRadiusTop, bodyRadiusBottom, bodyHeight, 12);
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color(factionTint[unit.owner]),
      emissive: new THREE.Color(factionAccent[unit.owner]),
      roughness: 0.42,
      metalness: 0.25,
    });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.castShadow = true;
    body.receiveShadow = true;
    body.userData.selection = { kind: "unit", id: unit.id };
    group.add(body);

    const headGeometry = new THREE.SphereGeometry(isWorker ? 0.45 : 0.52, 14, 12);
    const headMaterial = new THREE.MeshStandardMaterial({
      color: 0xf5e6c8,
      emissive: new THREE.Color(factionAccent[unit.owner]),
      roughness: 0.35,
      metalness: 0.28,
    });
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.position.y = bodyHeight * 0.42;
    head.userData.selection = { kind: "unit", id: unit.id };
    head.castShadow = true;
    head.receiveShadow = true;
    group.add(head);

    const hoverParts: THREE.Mesh[] = [body, head];

    if (isWorker) {
      const pack = new THREE.Mesh(
        new THREE.BoxGeometry(0.85, 0.65, 0.4),
        new THREE.MeshStandardMaterial({
          color: 0xffd57a,
          emissive: 0x6f4a12,
          roughness: 0.36,
          metalness: 0.18,
        }),
      );
      pack.position.set(0, bodyHeight * 0.1, -0.5);
      pack.rotation.y = THREE.MathUtils.degToRad(18);
      pack.castShadow = true;
      pack.receiveShadow = true;
      group.add(pack);
      hoverParts.push(pack);
    } else {
      const visor = new THREE.Mesh(
        new THREE.CylinderGeometry(0.26, 0.26, 0.8, 8),
        new THREE.MeshStandardMaterial({
          color: 0x25344a,
          emissive: 0x152131,
          roughness: 0.3,
          metalness: 0.38,
        }),
      );
      visor.position.set(0, bodyHeight * 0.22, 0.55);
      visor.rotation.x = THREE.MathUtils.degToRad(90);
      visor.userData.selection = { kind: "unit", id: unit.id };
      visor.castShadow = true;
      visor.receiveShadow = true;
      group.add(visor);
      hoverParts.push(visor);

      const pauldronMaterial = new THREE.MeshStandardMaterial({
        color: 0x2e4059,
        emissive: 0x132136,
        roughness: 0.34,
        metalness: 0.3,
      });
      const pauldronGeometry = new THREE.CapsuleGeometry(0.3, 0.3, 6, 12);
      const leftPad = new THREE.Mesh(pauldronGeometry, pauldronMaterial);
      leftPad.position.set(-0.65, bodyHeight * 0.15, 0);
      leftPad.rotation.z = THREE.MathUtils.degToRad(90);
      leftPad.castShadow = true;
      leftPad.receiveShadow = true;
      leftPad.userData.selection = { kind: "unit", id: unit.id };
      group.add(leftPad);
      hoverParts.push(leftPad);

      const rightPad = leftPad.clone();
      rightPad.position.x = 0.65;
      group.add(rightPad);
      hoverParts.push(rightPad);
    }

    const ring = createSelectionRing(1.1, factionTint[unit.owner]);
    group.add(ring);

    const health = createHealthBar(unit.owner, 1.6, 2.2);
    group.add(health.group);

    const hover = createHoverOutline(hoverParts, unit.owner);
    group.add(hover);

    group.position.set(unit.position.x, 0, unit.position.z);
    group.rotation.y = THREE.MathUtils.degToRad(unit.facingDeg);
    return { group, ring, body, health, hover };
  }

  function syncSelectionHighlight(
    entry: { ring: THREE.Mesh },
    selected: boolean,
    visible: boolean,
  ): void {
    entry.ring.visible = visible;
    const material = entry.ring.material;
    if (material instanceof THREE.Material) {
      material.opacity = selected ? 0.9 : 0.35;
    }
  }

  function isVisibleToPlayer(world: GameWorld, position: { x: number; z: number }): boolean {
    if (!currentMap) {
      return true;
    }
    const vision = world.vision.player;
    if (!vision) {
      return true;
    }
    const gx = Math.floor((position.x + currentMap.size.width / 2) / vision.cellSize);
    const gz = Math.floor((position.z + currentMap.size.height / 2) / vision.cellSize);
    if (gx < 0 || gz < 0 || gx >= vision.width || gz >= vision.height) {
      return false;
    }
    const idx = gz * vision.width + gx;
    return vision.visible[idx] === 1;
  }

  function syncBuildingMeshes(world: GameWorld, selection: Selection | null): void {
    const seen = new Set<string>();
    world.buildings.forEach((building) => {
      seen.add(building.id);
      const def = world.defs.buildings[building.typeId as BuildingTypeId];
      let entry = buildingMeshes.get(building.id);
      if (!entry) {
        entry = makeBuildingMesh(building, def);
        buildingMeshes.set(building.id, entry);
        scene.add(entry.group);
      }
      const visible =
        building.owner === "player" || isVisibleToPlayer(world, building.position);
      entry.group.visible = visible;
      entry.group.position.set(building.position.x, 0, building.position.z);
      entry.group.rotation.y = THREE.MathUtils.degToRad(building.facingDeg);
      const hpRatio = def.maxHp > 0 ? building.hp / def.maxHp : 0;
      updateHealthBar(entry.health, hpRatio);
      faceCamera(entry.health, entry.group);
      entry.health.group.visible = visible;
      entry.hover.visible =
        hoverSelection?.kind === "building" && hoverSelection.id === building.id && visible;
      syncSelectionHighlight(
        entry,
        selection?.id === building.id && selection.kind === "building",
        visible,
      );
    });

    buildingMeshes.forEach((entry, id) => {
      if (!seen.has(id)) {
        disposeEntityMesh(entry);
        buildingMeshes.delete(id);
      }
    });
  }

  function syncUnitMeshes(world: GameWorld, selection: Selection | null): void {
    const seen = new Set<string>();
    world.units.forEach((unit) => {
      seen.add(unit.id);
      let entry = unitMeshes.get(unit.id);
      if (!entry) {
        entry = makeUnitMesh(unit);
        unitMeshes.set(unit.id, entry);
        scene.add(entry.group);
      }
      const visible = unit.owner === "player" || isVisibleToPlayer(world, unit.position);
      entry.group.visible = visible;
      entry.group.position.set(unit.position.x, 0, unit.position.z);
      entry.group.rotation.y = THREE.MathUtils.degToRad(unit.facingDeg);
      const def = world.defs.units[unit.typeId];
      const hpRatio = def?.maxHp ? unit.hp / def.maxHp : 0;
      updateHealthBar(entry.health, hpRatio);
      faceCamera(entry.health, entry.group);
      entry.health.group.visible = visible;
      entry.hover.visible = hoverSelection?.kind === "unit" && hoverSelection.id === unit.id && visible;
      syncSelectionHighlight(
        entry,
        selection?.id === unit.id && selection.kind === "unit",
        visible,
      );
    });

    unitMeshes.forEach((entry, id) => {
      if (!seen.has(id)) {
        disposeEntityMesh(entry);
        unitMeshes.delete(id);
      }
    });
  }

  function syncResourceMeshes(world: GameWorld): void {
    world.resourceNodes.forEach((node) => {
      const entry = resourceMeshes.get(node.id) ?? resourceMeshes.get(node.spotId);
      if (!entry) {
        return;
      }
      if (entry.maxAmount <= 0) {
        entry.maxAmount = node.maxAmount || node.amount || 1;
      }
      const maxAmount = entry.maxAmount || node.maxAmount || 1;
      const ratio = maxAmount > 0 ? THREE.MathUtils.clamp(node.amount / maxAmount, 0, 1) : 0;
      const visible = isVisibleToPlayer(world, node.position);
      entry.body.scale.y = 0.2 + ratio * 0.8;
      entry.body.visible = visible && node.amount > 0.2;
      entry.ring.visible = visible && node.amount > 0.2;
      if (entry.ring.material instanceof THREE.Material) {
        entry.ring.material.opacity = 0.2 + ratio * 0.5;
      }
      if (entry.body.material instanceof THREE.Material) {
        entry.body.material.opacity = 0.5 + ratio * 0.5;
      }
    });
  }

  function ensureFog(world: GameWorld): void {
    if (!currentMap) {
      return;
    }
    const vision = world.vision.player;
    if (!vision) {
      disposeFog();
      return;
    }
    const needsRebuild =
      !fogMesh || !fogTexture || fogWidth !== vision.width || fogHeight !== vision.height;
    if (!needsRebuild) {
      return;
    }
    disposeFog();
    fogWidth = vision.width;
    fogHeight = vision.height;
    fogData = new Uint8Array(fogWidth * fogHeight);
    fogTexture = new THREE.DataTexture(
      fogData,
      fogWidth,
      fogHeight,
      THREE.RedFormat,
      THREE.UnsignedByteType,
    );
    fogTexture.flipY = false;
    fogTexture.colorSpace = THREE.NoColorSpace;
    fogTexture.wrapS = THREE.ClampToEdgeWrapping;
    fogTexture.wrapT = THREE.ClampToEdgeWrapping;
    fogTexture.magFilter = THREE.LinearFilter;
    fogTexture.minFilter = THREE.LinearFilter;
    fogTexture.needsUpdate = true;
    const geometry = new THREE.PlaneGeometry(currentMap.size.width, currentMap.size.height, 1, 1);
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0x0a0e19),
      transparent: true,
      depthWrite: false,
      depthTest: false,
      opacity: 1,
      alphaMap: fogTexture,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.32;
    mesh.renderOrder = 3;
    fogMesh = mesh;
    scene.add(mesh);
  }

  function syncFog(world: GameWorld): void {
    if (!currentMap || !world.vision.player) {
      return;
    }
    ensureFog(world);
    if (!fogData || !fogTexture) {
      return;
    }
    const { visible, explored } = world.vision.player;
    if (visible.length !== fogData.length) {
      ensureFog(world);
      if (!fogData || !fogTexture) {
        return;
      }
    }
    for (let i = 0; i < fogData.length; i += 1) {
      let alpha = 255;
      if (visible[i]) {
        alpha = 0;
      } else if (explored[i]) {
        alpha = 200;
      }
      fogData[i] = alpha;
    }
    fogTexture.needsUpdate = true;
    if (fogMesh) {
      fogMesh.visible = true;
    }
  }

  function rebuildPickTargets(): void {
    pickTargets.length = 0;
    buildingMeshes.forEach((entry) => {
      if (entry.group.visible) {
        pickTargets.push(entry.body);
      }
    });
    unitMeshes.forEach((entry) => {
      if (entry.group.visible) {
        pickTargets.push(entry.body);
      }
    });

    updateHoverFromPointer();
  }

  function pick(screenX: number, screenY: number): Selection | null {
    const rect = renderer.domElement.getBoundingClientRect();
    pointerNdc.set(
      ((screenX - rect.left) / rect.width) * 2 - 1,
      -((screenY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointerNdc, camera);
    const hits = raycaster.intersectObjects(pickTargets, true);
    if (!hits.length) {
      return null;
    }
    const selection = hits[0]!.object.userData.selection as Selection | undefined;
    return selection ?? null;
  }

  function updateHoverFromPointer(): void {
    if (!inputState.enabled || !inputState.pointerInside) {
      setHover(null);
      return;
    }
    const selection = pick(inputState.pointer.x, inputState.pointer.y);
    setHover(selection);
  }

  function projectToGround(
    screenX: number,
    screenY: number,
  ): { x: number; z: number } | null {
    const rect = renderer.domElement.getBoundingClientRect();
    pointerNdc.set(
      ((screenX - rect.left) / rect.width) * 2 - 1,
      -((screenY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointerNdc, camera);
    const hit = raycaster.ray.intersectPlane(groundPlane, groundPoint);
    if (!hit) {
      return null;
    }
    return { x: groundPoint.x, z: groundPoint.z };
  }

  function pickInRect(rect: DOMRect): Selection | null {
    if (!rect.width || !rect.height) {
      return null;
    }
    const view = renderer.domElement.getBoundingClientRect();
    const candidates: Array<{ selection: Selection; screen: { x: number; y: number } }> = [];

    function addCandidate(
      id: string,
      kind: Selection["kind"],
      position: THREE.Vector3,
    ): void {
      const projected = position.clone().project(camera);
      const screenX = ((projected.x + 1) / 2) * view.width + view.left;
      const screenY = ((-projected.y + 1) / 2) * view.height + view.top;
      if (
        screenX >= rect.left &&
        screenX <= rect.right &&
        screenY >= rect.top &&
        screenY <= rect.bottom
      ) {
        candidates.push({
          selection: { kind, id },
          screen: { x: screenX, y: screenY },
        });
      }
    }

    buildingMeshes.forEach((entry, id) => {
      const pos = new THREE.Vector3();
      pos.setFromMatrixPosition(entry.group.matrixWorld);
      addCandidate(id, "building", pos);
    });
    unitMeshes.forEach((entry, id) => {
      const pos = new THREE.Vector3();
      pos.setFromMatrixPosition(entry.group.matrixWorld);
      addCandidate(id, "unit", pos);
    });

    if (!candidates.length) {
      return null;
    }

    // Prefer units first, then buildings. Pick the one nearest to the center of the rectangle.
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    candidates.sort((a, b) => {
      if (a.selection.kind !== b.selection.kind) {
        return a.selection.kind === "unit" ? -1 : 1;
      }
      const da =
        (a.screen.x - centerX) * (a.screen.x - centerX) +
        (a.screen.y - centerY) * (a.screen.y - centerY);
      const db =
        (b.screen.x - centerX) * (b.screen.x - centerX) +
        (b.screen.y - centerY) * (b.screen.y - centerY);
      return da - db;
    });
    return candidates[0]?.selection ?? null;
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
    desiredTarget.x += direction.x * panSpeed * deltaSeconds;
    desiredTarget.z += direction.y * panSpeed * deltaSeconds;
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
    updateHoverFromPointer();
  }

  function onPointerLeave(): void {
    inputState.pointerInside = false;
    setHover(null);
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
    disposeFog();
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
    setCameraSensitivity: (multiplier: number) => {
      panSpeed = THREE.MathUtils.clamp(
        settings.camera.panSpeed * multiplier,
        settings.camera.panSpeed * 0.3,
        settings.camera.panSpeed * 3,
      );
    },
    updateWorld: (world: GameWorld, selection: Selection | null) => {
      syncResourceMeshes(world);
      syncBuildingMeshes(world, selection);
      syncUnitMeshes(world, selection);
      syncFog(world);
      rebuildPickTargets();
      updateHoverFromPointer();
    },
    pick,
    pickInRect,
    projectToGround,
    dispose: () => {
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onWindowBlur);
      renderer.dispose();
      disposeFog();
      disposeGroup(resourceGroup);
      disposeGroup(startGroup);
      resourceGroup = null;
      startGroup = null;
      resourceMeshes.clear();
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
      buildingMeshes.forEach((entry) => disposeEntityMesh(entry));
      unitMeshes.forEach((entry) => disposeEntityMesh(entry));
      buildingMeshes.clear();
      unitMeshes.clear();
      pickTargets.length = 0;
    },
  };
}
