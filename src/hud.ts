import * as THREE from "three";

export type HudCallbacks = {
  onRestart?: () => void;
  onMenu?: () => void;
};

export type HudOutcome =
  | { state: "win" | "lose" | "draw"; message: string }
  | null;

export type HudValues = {
  spice: string;
  power: string;
};

export type HudLayer = {
  setVisible(visible: boolean): void;
  setValues(values: HudValues): void;
  setOutcome(outcome: HudOutcome): void;
  setSelectionRect(rect: { left: number; top: number; width: number; height: number } | null): void;
  resize(width: number, height: number): void;
  render(renderer: THREE.WebGLRenderer): void;
  handlePointer(event: PointerEvent): boolean;
  setCallbacks(callbacks: HudCallbacks): void;
};

type TextOptions = {
  fontSize?: number;
  color?: string;
  weight?: "400" | "500" | "600" | "700";
  maxWidth?: number;
  letterSpacing?: number;
  align?: "left" | "center";
};

type TextLabel = {
  mesh: THREE.Mesh;
  setText: (value: string, nextMaxWidth?: number) => void;
  getSize: () => { width: number; height: number };
};

type HudButtonId = "restart" | "menu";

type HudButton = {
  id: HudButtonId;
  group: THREE.Group;
  background: THREE.Mesh;
  label: TextLabel;
  area: { x: number; y: number; width: number; height: number };
};

type PanelGroup = {
  group: THREE.Group;
  background: THREE.Mesh;
};

function createTextLabel(text: string, options: TextOptions = {}): TextLabel {
  const { color = "#f6d9a1", fontSize = 18, weight = "700", maxWidth, letterSpacing = 0, align = "left" } = options;
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshBasicMaterial({ transparent: true, toneMapped: false });
  const mesh = new THREE.Mesh(geometry, material);

  function draw(
    value: string,
    overrideMaxWidth?: number,
  ): { width: number; height: number; texture: THREE.Texture } {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Не удалось создать контекст HUD");
    }
    const font = `${weight} ${fontSize}px "Space Grotesk", "Exo 2", system-ui, sans-serif`;
    ctx.font = font;
    ctx.textBaseline = "middle";
    const maxLineWidth = overrideMaxWidth ?? maxWidth ?? ctx.measureText(value).width;
    const words = value.split(" ");
    const lines: string[] = [];
    let current = "";
    words.forEach((word) => {
      const test = current ? `${current} ${word}` : word;
      if (ctx.measureText(test).width <= maxLineWidth || !current) {
        current = test;
      } else {
        lines.push(current);
        current = word;
      }
    });
    if (current) {
      lines.push(current);
    }
    const padding = Math.round(fontSize * 0.25);
    const lineHeight = fontSize * 1.2;
    const width = Math.ceil(Math.min(maxLineWidth, Math.max(...lines.map((line) => ctx.measureText(line).width))) + padding * 2);
    const height = Math.ceil(lineHeight * lines.length + padding * 2);
    canvas.width = Math.max(16, width);
    canvas.height = Math.max(16, height);
    ctx.font = font;
    ctx.textBaseline = "middle";
    ctx.fillStyle = color;
    ctx.textAlign = align === "center" ? "center" : "left";
    const xOffset = align === "center" ? canvas.width / 2 : padding;
    lines.forEach((line, index) => {
      const x = xOffset;
      const y = padding + lineHeight * index + lineHeight / 2;
      if (letterSpacing !== 0) {
        const chars = Array.from(line);
        let cursor = x;
        chars.forEach((ch) => {
          ctx.fillText(ch, cursor, y);
          cursor += ctx.measureText(ch).width + letterSpacing;
        });
      } else {
        ctx.fillText(line, x, y);
      }
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return { width: canvas.width, height: canvas.height, texture };
  }

  function setText(value: string, nextMaxWidth?: number): void {
    const { width, height, texture } = draw(value, nextMaxWidth);
    if (material.map) {
      material.map.dispose();
    }
    material.map = texture;
    material.needsUpdate = true;
    mesh.scale.set(width, height, 1);
  }

  setText(text);

  return {
    mesh,
    setText,
    getSize: () => ({ width: mesh.scale.x, height: mesh.scale.y }),
  };
}

function createPanel(width: number, height: number, color: number, opacity = 0.85): PanelGroup {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.scale.set(width, height, 1);
  mesh.position.set(width / 2, height / 2, 0);
  const group = new THREE.Group();
  group.add(mesh);
  return { group, background: mesh };
}

function createButton(id: HudButtonId, label: string): HudButton {
  const group = new THREE.Group();
  const { group: bgGroup, background } = createPanel(140, 44, 0x1b140f, 0.9);
  const labelText = createTextLabel(label, { fontSize: 16, weight: "700", color: "#f6d9a1", align: "center" });
  labelText.mesh.position.z = 0.01;
  group.add(bgGroup);
  group.add(labelText.mesh);
  const area = { x: 0, y: 0, width: 140, height: 44 };
  return { id, group, background, label: labelText, area };
}

export function createHudLayer(renderer: THREE.WebGLRenderer): HudLayer {
  const hudScene = new THREE.Scene();
  const hudCamera = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10);
  hudCamera.position.z = 5;
  hudScene.add(hudCamera);

  const hudRoot = new THREE.Group();
  hudScene.add(hudRoot);

  let hudVisible = false;
  let hudWidth = 1;
  let hudHeight = 1;
  let resourceArea = { x: 0, y: 0, width: 0, height: 0 };
  let outcomeArea = { x: 0, y: 0, width: 0, height: 0 };
  let outcomeState: HudOutcome = null;
  let lastOutcomeKey = "";
  let lastValues: HudValues = { spice: "—", power: "—" };
  let selectionVisible = false;
  let callbacks: HudCallbacks = {};
  let activeButton: HudButton | null = null;
  let activePointerId: number | null = null;

  const selectionFill = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xf6d9a1),
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  selectionFill.visible = false;
  selectionFill.renderOrder = 4;
  hudScene.add(selectionFill);

  const selectionLineGeometry = new THREE.BufferGeometry();
  selectionLineGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(15), 3));
  const selectionLine = new THREE.LineLoop(
    selectionLineGeometry,
    new THREE.LineBasicMaterial({
      color: new THREE.Color(0xf6d9a1),
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  selectionLine.visible = false;
  selectionLine.renderOrder = 5;
  hudScene.add(selectionLine);

  const resourcePanel = createPanel(260, 96, 0x120d0a, 0.86);
  resourcePanel.background.renderOrder = 2;
  resourcePanel.group.renderOrder = 2;
  hudRoot.add(resourcePanel.group);

  const tileBgMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0x1b140f),
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    toneMapped: false,
  });

  function createResourceTile(label: string, valueColor: string): {
    group: THREE.Group;
    valueLabel: TextLabel;
    label: TextLabel;
    background: THREE.Mesh;
  } {
    const group = new THREE.Group();
    const background = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), tileBgMaterial.clone());
    background.renderOrder = 3;
    group.add(background);
    const title = createTextLabel(label, { fontSize: 12, weight: "600", color: "#c9b08c", letterSpacing: 0.4 });
    const value = createTextLabel("—", { fontSize: 22, weight: "700", color: valueColor });
    title.mesh.position.z = 0.01;
    value.mesh.position.z = 0.01;
    group.add(title.mesh);
    group.add(value.mesh);
    return { group, valueLabel: value, label: title, background };
  }

  const spiceTile = createResourceTile("СПАЙС", "#f7c76b");
  const powerTile = createResourceTile("ЭНЕРГИЯ", "#d8e0ff");
  resourcePanel.group.add(spiceTile.group);
  resourcePanel.group.add(powerTile.group);

  const outcomePanel = createPanel(360, 200, 0x0f0b08, 0.92);
  outcomePanel.group.visible = false;
  outcomePanel.group.renderOrder = 6;
  hudRoot.add(outcomePanel.group);

  const outcomeBadge = createTextLabel("Матч завершен", {
    fontSize: 14,
    weight: "700",
    color: "#f6d9a1",
    align: "center",
    letterSpacing: 0.5,
  });
  outcomeBadge.mesh.position.z = 0.01;
  const outcomeMessage = createTextLabel("", {
    fontSize: 18,
    weight: "700",
    color: "#f0e5d2",
    maxWidth: 460,
    align: "center",
  });
  outcomeMessage.mesh.position.z = 0.01;
  outcomePanel.group.add(outcomeBadge.mesh);
  outcomePanel.group.add(outcomeMessage.mesh);

  const restartButton = createButton("restart", "Снова в бой");
  const menuButton = createButton("menu", "В меню");
  outcomePanel.group.add(restartButton.group);
  outcomePanel.group.add(menuButton.group);
  const hudButtons: HudButton[] = [restartButton, menuButton];

  function setButtonActive(button: HudButton, active: boolean): void {
    const material = button.background.material;
    if (material instanceof THREE.MeshBasicMaterial) {
      material.color.set(active ? 0xe3b464 : 0x1b140f);
      material.opacity = active ? 0.92 : 0.88;
    }
    const labelMat = button.label.mesh.material;
    if (labelMat instanceof THREE.MeshBasicMaterial) {
      labelMat.color.set(active ? 0x1a120d : 0xf6d9a1);
    }
  }

  function updateSelectionRect(rect: { left: number; top: number; width: number; height: number } | null): void {
    if (!rect || rect.width < 2 || rect.height < 2 || !hudVisible) {
      selectionFill.visible = false;
      selectionLine.visible = false;
      selectionVisible = false;
      return;
    }
    selectionVisible = true;
    selectionFill.visible = true;
    selectionLine.visible = true;
    selectionFill.scale.set(rect.width, rect.height, 1);
    selectionFill.position.set(rect.left + rect.width / 2, rect.top + rect.height / 2, 0);
    const positions = selectionLineGeometry.getAttribute("position") as THREE.BufferAttribute;
    const points: Array<[number, number, number]> = [
      [rect.left, rect.top, 0],
      [rect.left + rect.width, rect.top, 0],
      [rect.left + rect.width, rect.top + rect.height, 0],
      [rect.left, rect.top + rect.height, 0],
      [rect.left, rect.top, 0],
    ];
    points.forEach((point, idx) => {
      positions.setXYZ(idx, point[0], point[1], point[2]);
    });
    positions.needsUpdate = true;
  }

  function layoutResources(): void {
    const margin = Math.max(8, Math.min(18, hudWidth * 0.025));
    const panelWidth = Math.min(Math.max(hudWidth * 0.36, 220), Math.max(260, hudWidth - margin * 2));
    const isNarrow = hudWidth < 720;
    const panelHeight = isNarrow ? 126 : 96;
    resourcePanel.background.scale.set(panelWidth, panelHeight, 1);
    resourcePanel.background.position.set(panelWidth / 2, panelHeight / 2, 0);
    resourcePanel.group.position.set(hudWidth - panelWidth - margin, margin, 0);
    const padding = 12;
    const tileGap = isNarrow ? 12 : 10;
    const tileWidth = isNarrow
      ? panelWidth - padding * 2
      : (panelWidth - padding * 2 - tileGap) / 2;
    const tileHeight = 58;
    const tileY = padding;
    const secondRowY = tileHeight + padding + (isNarrow ? tileGap : 0);
    const powerY = isNarrow ? secondRowY : tileY;
    spiceTile.background.scale.set(tileWidth, tileHeight, 1);
    spiceTile.background.position.set(tileWidth / 2, tileHeight / 2, 0);
    spiceTile.group.position.set(padding, tileY, 0.01);
    powerTile.background.scale.set(tileWidth, tileHeight, 1);
    powerTile.background.position.set(tileWidth / 2, tileHeight / 2, 0);
    powerTile.group.position.set(isNarrow ? padding : padding + tileWidth + tileGap, powerY, 0.01);

    const labelY = 14;
    const valueY = 34;
    [spiceTile.label, powerTile.label].forEach((label) => {
      const size = label.getSize();
      label.mesh.position.set(12 + size.width / 2, labelY + size.height / 2, 0.02);
    });
    [spiceTile.valueLabel, powerTile.valueLabel].forEach((valueLabel) => {
      const size = valueLabel.getSize();
      valueLabel.mesh.position.set(12 + size.width / 2, valueY + size.height / 2, 0.02);
    });

    resourceArea = {
      x: resourcePanel.group.position.x,
      y: resourcePanel.group.position.y,
      width: panelWidth,
      height: panelHeight,
    };
  }

  function layoutOutcome(): void {
    if (!outcomeState) {
      outcomeArea = { x: 0, y: 0, width: 0, height: 0 };
      return;
    }
    const margin = Math.max(10, Math.min(20, hudWidth * 0.03));
    const width = Math.min(Math.max(hudWidth * 0.6, 300), hudWidth - margin * 2);
    const padding = Math.max(14, Math.min(22, width * 0.08));
    const buttonGap = width < 420 ? 10 : 14;
    const buttonsStacked = width < 420;
    const badgeSize = outcomeBadge.getSize();
    const messageSize = outcomeMessage.getSize();
    const buttonWidth = Math.min(180, Math.max(140, (width - padding * 2 - buttonGap) / (buttonsStacked ? 1 : 2)));
    const buttonHeight = 46;
    const buttonRowHeight = buttonsStacked ? buttonHeight * 2 + buttonGap : buttonHeight;
    const contentHeight = padding + badgeSize.height + 12 + messageSize.height + 18 + buttonRowHeight + padding;
    outcomePanel.background.scale.set(width, contentHeight, 1);
    outcomePanel.background.position.set(width / 2, contentHeight / 2, 0);
    const posX = (hudWidth - width) / 2;
    const posY = Math.max(margin, hudHeight * 0.22);
    outcomePanel.group.position.set(posX, posY, 0.02);

    outcomeBadge.mesh.position.set(width / 2, padding + badgeSize.height / 2, 0.03);
    outcomeMessage.mesh.position.set(width / 2, padding + badgeSize.height + 12 + messageSize.height / 2, 0.03);

    const firstButtonX = padding + buttonWidth / 2;
    const secondButtonX = buttonsStacked ? padding + buttonWidth / 2 : padding + buttonWidth + buttonGap + buttonWidth / 2;
    const buttonY = padding + badgeSize.height + 12 + messageSize.height + 18 + buttonHeight / 2;
    restartButton.background.scale.set(buttonWidth, buttonHeight, 1);
    restartButton.background.position.set(buttonWidth / 2, buttonHeight / 2, 0);
    restartButton.group.position.set(firstButtonX, buttonY, 0.03);
    restartButton.label.mesh.position.set(buttonWidth / 2, buttonHeight / 2, 0.04);
    menuButton.background.scale.set(buttonWidth, buttonHeight, 1);
    menuButton.background.position.set(buttonWidth / 2, buttonHeight / 2, 0);
    menuButton.group.position.set(secondButtonX, buttonsStacked ? buttonY + buttonHeight + buttonGap : buttonY, 0.03);
    menuButton.label.mesh.position.set(buttonWidth / 2, buttonHeight / 2, 0.04);

    restartButton.area = { x: posX + firstButtonX - buttonWidth / 2, y: posY + buttonY - buttonHeight / 2, width: buttonWidth, height: buttonHeight };
    menuButton.area = {
      x: posX + secondButtonX - buttonWidth / 2,
      y: posY + (buttonsStacked ? buttonY + buttonHeight + buttonGap : buttonY) - buttonHeight / 2,
      width: buttonWidth,
      height: buttonHeight,
    };

    outcomeArea = { x: posX, y: posY, width, height: contentHeight };
  }

  function layoutHud(): void {
    hudCamera.left = 0;
    hudCamera.right = hudWidth;
    hudCamera.top = 0;
    hudCamera.bottom = hudHeight;
    hudCamera.updateProjectionMatrix();
    layoutResources();
    layoutOutcome();
    if (!selectionVisible) {
      selectionFill.visible = false;
      selectionLine.visible = false;
    }
  }

  function setValues(values: HudValues): void {
    if (values.spice === lastValues.spice && values.power === lastValues.power) {
      return;
    }
    lastValues = { ...values };
    spiceTile.valueLabel.setText(values.spice);
    powerTile.valueLabel.setText(values.power);
    layoutResources();
  }

  function setOutcome(outcome: HudOutcome): void {
    const key = outcome ? `${outcome.state}:${outcome.message}` : "";
    if (key === lastOutcomeKey) {
      outcomeState = outcome;
      outcomePanel.group.visible = !!outcome && hudVisible;
      return;
    }
    lastOutcomeKey = key;
    outcomeState = outcome;
    outcomePanel.group.visible = !!outcome && hudVisible;
    if (!outcome) {
      return;
    }
    const label =
      outcome.state === "win" ? "Победа" : outcome.state === "lose" ? "Поражение" : "Ничья";
    const tone = outcome.state === "win" ? 0x8ff2a9 : outcome.state === "lose" ? 0xffb4a2 : 0xf6d9a1;
    const badgeMat = outcomeBadge.mesh.material;
    if (badgeMat instanceof THREE.MeshBasicMaterial) {
      badgeMat.color.set(tone);
    }
    outcomeBadge.setText(label);
    const maxTextWidth = Math.min(Math.max(hudWidth * 0.55, 260), hudWidth - 80);
    outcomeMessage.setText(outcome.message, maxTextWidth);
    layoutOutcome();
  }

  function setVisible(visible: boolean): void {
    hudVisible = visible;
    if (!visible) {
      releaseActive();
    }
    hudRoot.visible = visible;
    selectionFill.visible = visible && selectionVisible;
    selectionLine.visible = visible && selectionVisible;
    outcomePanel.group.visible = visible && !!outcomeState;
  }

  function resize(width: number, height: number): void {
    hudWidth = Math.max(1, width);
    hudHeight = Math.max(1, height);
    layoutHud();
  }

  function render(rendererInstance: THREE.WebGLRenderer): void {
    if (!hudVisible) {
      return;
    }
    rendererInstance.clearDepth();
    rendererInstance.render(hudScene, hudCamera);
  }

  function toHudCoords(event: PointerEvent): { x: number; y: number } {
    const rect = renderer.domElement.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function hitTest(point: { x: number; y: number }): HudButton | "panel" | "outcome" | null {
    if (!hudVisible) {
      return null;
    }
    if (
      outcomeState &&
      point.x >= outcomeArea.x &&
      point.x <= outcomeArea.x + outcomeArea.width &&
      point.y >= outcomeArea.y &&
      point.y <= outcomeArea.y + outcomeArea.height
    ) {
      for (const button of hudButtons) {
        const { x, y, width, height } = button.area;
        if (point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height) {
          return button;
        }
      }
      return "outcome";
    }
    if (
      point.x >= resourceArea.x &&
      point.x <= resourceArea.x + resourceArea.width &&
      point.y >= resourceArea.y &&
      point.y <= resourceArea.y + resourceArea.height
    ) {
      return "panel";
    }
    return null;
  }

  function releaseActive(): void {
    if (activeButton) {
      setButtonActive(activeButton, false);
    }
    activePointerId = null;
    activeButton = null;
  }

  function handlePointer(event: PointerEvent): boolean {
    const handledFlag = "__hudHandled";
    if ((event as unknown as Record<string, boolean>)[handledFlag]) {
      return true;
    }
    if (!hudVisible) {
      return false;
    }
    const point = toHudCoords(event);
    const hit = hitTest(point);
    if (event.type === "pointerdown") {
      if (hit && hit !== "panel" && hit !== "outcome") {
        activeButton = hit;
        activePointerId = event.pointerId;
        setButtonActive(hit, true);
        (event as unknown as Record<string, boolean>)[handledFlag] = true;
        return true;
      }
      if (hit) {
        (event as unknown as Record<string, boolean>)[handledFlag] = true;
      }
      return hit !== null;
    }
    if (event.type === "pointermove") {
      if (activeButton) {
        const inside = hit && hit !== "panel" && hit !== "outcome" && hit.id === activeButton.id;
        setButtonActive(activeButton, !!inside);
        (event as unknown as Record<string, boolean>)[handledFlag] = true;
        return true;
      }
      if (hit) {
        (event as unknown as Record<string, boolean>)[handledFlag] = true;
      }
      return hit !== null;
    }
    if (event.type === "pointerup" || event.type === "pointercancel") {
      if (activeButton && activePointerId === event.pointerId) {
        const shouldFire = hit && hit !== "panel" && hit !== "outcome" && hit.id === activeButton.id;
        const id = activeButton.id;
        releaseActive();
        if (shouldFire) {
          if (id === "restart") {
            callbacks.onRestart?.();
          } else if (id === "menu") {
            callbacks.onMenu?.();
          }
        }
        (event as unknown as Record<string, boolean>)[handledFlag] = true;
        return true;
      }
      releaseActive();
      if (hit) {
        (event as unknown as Record<string, boolean>)[handledFlag] = true;
      }
      return hit !== null;
    }
    return false;
  }

  return {
    setVisible,
    setValues,
    setOutcome,
    setSelectionRect: updateSelectionRect,
    resize,
    render,
    handlePointer,
    setCallbacks: (next: HudCallbacks) => {
      callbacks = next;
    },
  };
}
