function mustGet(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element;
}

export interface HudValues {
  distance: number;
  speed: number;
  time: number;
  best: number;
  offroad: boolean;
}

export class Hud {
  private readonly distance = mustGet('hud-distance');
  private readonly speed = mustGet('hud-speed');
  private readonly time = mustGet('hud-time');
  private readonly best = mustGet('hud-best');
  private readonly offroad = mustGet('hud-offroad');
  private readonly combo = mustGet('hud-combo');
  private readonly root = mustGet('hud');
  private comboTimeout = 0;
  private last: HudValues = { distance: -1, speed: -1, time: -1, best: -1, offroad: false };

  setVisible(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
    this.root.setAttribute('aria-hidden', visible ? 'false' : 'true');
  }

  update(values: HudValues): void {
    if (Math.abs(values.speed - this.last.speed) >= 1) {
      this.speed.textContent = String(Math.round(values.speed));
      this.last.speed = values.speed;
    }
    if (Math.abs(values.distance - this.last.distance) >= 1) {
      this.distance.innerHTML = `${Math.round(values.distance).toLocaleString('en-US')}<span class="unit">m</span>`;
      this.last.distance = values.distance;
    }
    if (Math.abs(values.time - this.last.time) >= 0.1) {
      this.time.innerHTML = `${values.time.toFixed(1)}<span class="unit">s</span>`;
      this.last.time = values.time;
    }
    if (values.best !== this.last.best) {
      this.best.innerHTML = `${Math.round(values.best).toLocaleString('en-US')}<span class="unit">m</span>`;
      this.last.best = values.best;
    }
    if (values.offroad !== this.last.offroad) {
      this.offroad.classList.toggle('on', values.offroad);
      this.last.offroad = values.offroad;
    }
  }

  showCombo(text: string, duration = 1100): void {
    this.combo.textContent = text;
    this.combo.classList.add('on');
    window.clearTimeout(this.comboTimeout);
    this.comboTimeout = window.setTimeout(() => this.combo.classList.remove('on'), duration);
  }

  reset(): void {
    this.last = { distance: -1, speed: -1, time: -1, best: -1, offroad: false };
  }
}
