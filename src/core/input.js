// Unified input: keyboard + mouse (pointer lock) + touch (virtual joystick, camera drag, buttons)
export const isTouch = (('ontouchstart' in window) || navigator.maxTouchPoints > 0) && matchMedia('(pointer: coarse)').matches;

const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  Space: 'jump', ShiftLeft: 'sprint', ShiftRight: 'sprint', KeyE: 'interact', KeyF: 'instinct', KeyC: 'dodge',
  KeyJ: 'atk1', KeyK: 'atk2', Digit1: 'skill1', Digit2: 'skill2', Digit3: 'skill3', KeyQ: 'ult1', KeyR: 'ult2',
  KeyM: 'map', Tab: 'map', Escape: 'pause', KeyP: 'pause', KeyI: 'abilities', KeyL: 'journal', KeyV: 'camMode', KeyX: 'sit', KeyG: 'voice',
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.held = new Set();
    this.pressed = new Set();   // pressed this frame
    this.released = new Set();
    this.move = { x: 0, y: 0 };  // x right, y forward
    this.look = { x: 0, y: 0 };  // accumulated camera delta (pixels)
    this.zoom = 0;
    this.pointerLocked = false;
    this.enabled = true;
    this.touchMove = { x: 0, y: 0, active: false };
    this.lookSensitivity = 1;
    this._bind();
  }
  _bind() {
    window.addEventListener('keydown', (e) => {
      const a = KEYMAP[e.code];
      if (!a) return;
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (e.repeat) return;
      this.press(a);
    });
    window.addEventListener('keyup', (e) => { const a = KEYMAP[e.code]; if (a) this.release(a); });
    window.addEventListener('blur', () => { for (const a of [...this.held]) this.release(a); });

    // Mouse
    this.canvas.addEventListener('mousedown', (e) => {
      if (isTouch) return;
      if (!this.pointerLocked && this.wantPointerLock) {
        this.canvas.requestPointerLock?.();
        return;
      }
      if (e.button === 0) this.press('atk1');
      if (e.button === 2) this.press('atk2');
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.release('atk1');
      if (e.button === 2) this.release('atk2');
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      this.onPointerLockChange?.(this.pointerLocked);
    });
    window.addEventListener('mousemove', (e) => {
      if (this.pointerLocked) { this.look.x += e.movementX * this.lookSensitivity; this.look.y += e.movementY * this.lookSensitivity; }
    });
    this.canvas.addEventListener('wheel', (e) => { this.zoom += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });

    // Touch on canvas: left half joystick, right half camera
    this.joy = null; this.lookTouch = null;
    const ts = (e) => {
      for (const t of e.changedTouches) {
        if (t.clientX < window.innerWidth * 0.42 && !this.joy) {
          this.joy = { id: t.identifier, ox: t.clientX, oy: t.clientY, x: t.clientX, y: t.clientY };
          this.onJoy?.(this.joy);
        } else if (!this.lookTouch) {
          this.lookTouch = { id: t.identifier, x: t.clientX, y: t.clientY };
        }
      }
      e.preventDefault();
    };
    const tm = (e) => {
      for (const t of e.changedTouches) {
        if (this.joy && t.identifier === this.joy.id) {
          this.joy.x = t.clientX; this.joy.y = t.clientY;
          const R = 55;
          let dx = (this.joy.x - this.joy.ox) / R, dy = (this.joy.y - this.joy.oy) / R;
          const l = Math.hypot(dx, dy);
          if (l > 1) {
            // drag origin along so the stick follows the finger
            this.joy.ox += (dx / l) * (l - 1) * R; this.joy.oy += (dy / l) * (l - 1) * R;
            dx /= l; dy /= l;
          }
          this.touchMove.x = dx; this.touchMove.y = -dy; this.touchMove.active = true;
          this.touchMove.mag = Math.min(1, l);
          this.onJoy?.(this.joy);
        } else if (this.lookTouch && t.identifier === this.lookTouch.id) {
          this.look.x += (t.clientX - this.lookTouch.x) * 1.6 * this.lookSensitivity;
          this.look.y += (t.clientY - this.lookTouch.y) * 1.6 * this.lookSensitivity;
          this.lookTouch.x = t.clientX; this.lookTouch.y = t.clientY;
        }
      }
      e.preventDefault();
    };
    const te = (e) => {
      for (const t of e.changedTouches) {
        if (this.joy && t.identifier === this.joy.id) {
          this.joy = null; this.touchMove.x = 0; this.touchMove.y = 0; this.touchMove.active = false;
          this.onJoy?.(null);
        } else if (this.lookTouch && t.identifier === this.lookTouch.id) this.lookTouch = null;
      }
    };
    this.canvas.addEventListener('touchstart', ts, { passive: false });
    this.canvas.addEventListener('touchmove', tm, { passive: false });
    this.canvas.addEventListener('touchend', te);
    this.canvas.addEventListener('touchcancel', te);
  }
  /** Bind a DOM button to an action (works for touch + mouse). */
  bindButton(el, action) {
    const down = (e) => { e.preventDefault(); e.stopPropagation(); this.press(action); el.classList.add('down'); };
    const up = (e) => { e.preventDefault(); this.release(action); el.classList.remove('down'); };
    el.addEventListener('touchstart', down, { passive: false });
    el.addEventListener('touchend', up, { passive: false });
    el.addEventListener('touchcancel', up, { passive: false });
    el.addEventListener('mousedown', down);
    el.addEventListener('mouseup', up);
    el.addEventListener('mouseleave', (e) => { if (this.held.has(action)) up(e); });
  }
  press(a) { if (!this.held.has(a)) { this.held.add(a); this.pressed.add(a); } }
  release(a) { if (this.held.has(a)) { this.held.delete(a); this.released.add(a); } }
  down(a) { return this.enabled && this.held.has(a); }
  hit(a) { return this.enabled && this.pressed.has(a); }
  up(a) { return this.enabled && this.released.has(a); }
  /** Call once per frame before game update. */
  sample() {
    let x = 0, y = 0;
    if (this.held.has('left')) x -= 1;
    if (this.held.has('right')) x += 1;
    if (this.held.has('up')) y += 1;
    if (this.held.has('down')) y -= 1;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    if (this.touchMove.active) { x = this.touchMove.x; y = this.touchMove.y; }
    this.move.x = this.enabled ? x : 0; this.move.y = this.enabled ? y : 0;
    // Analog: touch joystick past 85% counts as sprint
    this.analogSprint = this.touchMove.active && (this.touchMove.mag || 0) > 0.92;
  }
  consumeLook() { const l = { x: this.look.x, y: this.look.y }; this.look.x = this.look.y = 0; return l; }
  consumeZoom() { const z = this.zoom; this.zoom = 0; return z; }
  endFrame() { this.pressed.clear(); this.released.clear(); }
  clearAll() { for (const a of [...this.held]) this.release(a); this.pressed.clear(); this.released.clear(); }
}
