export type InputAction = 'start' | 'pause' | 'restart' | 'mute' | 'any';

export interface InputState {
  left: boolean;
  right: boolean;
  accel: boolean;
  brake: boolean;
  boost: boolean;
}

const KEY_TO_FIELD: Record<string, keyof InputState> = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'accel',
  KeyW: 'accel',
  ArrowDown: 'brake',
  KeyS: 'brake',
  Space: 'boost',
};

export class Input {
  readonly state: InputState = {
    left: false,
    right: false,
    accel: false,
    brake: false,
    boost: false,
  };

  private readonly onAction: (action: InputAction) => void;

  constructor(onAction: (action: InputAction) => void) {
    this.onAction = onAction;

    window.addEventListener('keydown', this.handleKeyDown, { passive: false });
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.clear);

    const touch = document.getElementById('touch');
    touch?.addEventListener('pointerdown', this.handlePointer);
    touch?.addEventListener('pointerup', this.handlePointerUp);
    touch?.addEventListener('pointercancel', this.handlePointerUp);
    touch?.addEventListener('pointerleave', this.handlePointerUp);

    document.getElementById('start-button')?.addEventListener('click', (event) => {
      event.stopPropagation();
      this.onAction('start');
    });
    document.getElementById('resume-button')?.addEventListener('click', (event) => {
      event.stopPropagation();
      this.onAction('pause');
    });
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    const field = KEY_TO_FIELD[event.code];
    if (field) {
      event.preventDefault();
      this.state[field] = true;
      this.onAction('any');
      return;
    }

    switch (event.code) {
      case 'Enter':
      case 'NumpadEnter':
        event.preventDefault();
        this.onAction('start');
        break;
      case 'Escape':
      case 'KeyP':
        event.preventDefault();
        this.onAction('pause');
        break;
      case 'KeyR':
        event.preventDefault();
        this.onAction('restart');
        break;
      case 'KeyM':
        event.preventDefault();
        this.onAction('mute');
        break;
      default:
        break;
    }
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    const field = KEY_TO_FIELD[event.code];
    if (field) {
      event.preventDefault();
      this.state[field] = false;
    }
  };

  private handlePointer = (event: PointerEvent): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const key = target.dataset.key;
    if (!key) return;
    event.preventDefault();
    this.onAction('any');
    if (key === 'left') this.state.left = true;
    if (key === 'right') this.state.right = true;
    if (key === 'boost') this.state.boost = true;
    target.classList.add('on');
  };

  private handlePointerUp = (event: PointerEvent): void => {
    const target = event.target;
    if (target instanceof HTMLElement) {
      const key = target.dataset.key;
      if (key === 'left') this.state.left = false;
      if (key === 'right') this.state.right = false;
      if (key === 'boost') this.state.boost = false;
      target.classList.remove('on');
    }
    // Releasing outside the button must not leave the car turning forever.
    document.querySelectorAll<HTMLElement>('.touch-btn.on').forEach((element) => {
      element.classList.remove('on');
    });
    this.state.left = false;
    this.state.right = false;
    this.state.boost = false;
  };

  private clear = (): void => {
    this.state.left = false;
    this.state.right = false;
    this.state.accel = false;
    this.state.brake = false;
    this.state.boost = false;
  };
}
