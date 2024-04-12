import * as Animated from "animated/lib/targets/react-dom";


let currentBox = null;
let currentPan = null;
let maxIndex = null;

const raf = fn => setTimeout(fn, 0);
raf.cancel = id => clearTimeout(id);

const VERTICAL = 'VERTICAL';
const HORIZONTAL = 'HORIZONTAL';

const clamp = (n, min, max) => Math.max(Math.min(n, max), min);

class Pan {
  static getPanFor = (cards, initialScope, boxActuals) => {
    if (currentBox === JSON.stringify(boxActuals)) return currentPan;
    currentBox = JSON.stringify(boxActuals);
    currentPan = new Pan(cards, initialScope, boxActuals);
    return currentPan;
  }

  constructor(stackCards, initialScope, actual) {
    this.cards = stackCards;
    this.enabled = true;
    this.target = {
      maxIndex: stackCards.length > 0 ? stackCards.length - 1 : 0,
      activeIndex: 0,
      yesIndices: [],
      noIndices: [],
      card: 0,
      yes: 0,
      scroll: 0,
      minCard: -0.05,
      maxCard: 1,
      maxScroll: 0,
      overScroll: 0,
    };
    this.anims = stackCards.map(() => ({
      yes: new Animated.Value(0),
      ribbonOpacity: new Animated.Value(0),
      yesY: new Animated.Value(0),
      anchor: new Animated.Value(0),
      card: new Animated.Value(0),
      scroll: new Animated.Value(0),
    }))
    this.actual = actual;
    maxIndex = this.target.maxIndex;
    this.reset();
    this.handleScope(initialScope);
  };

  handleMove = ({ clientX, clientY }) => {
    if (!this.enabled) this.forceStop();
    if (!this.updating || !this.enabled) {
      return console.error(this.enabled);
    }
    const [startX, startY] = this.startXY;
    this.updateVelocity({ clientX, clientY });
    this.dx = clientX - startX;
    this.dy = clientY - startY;
    this.pendingUpdates = true;
    this.af = raf(this.tick);
    return true;
  }

  reset = () => {
    this.updating = false;
    this.dx = null;
    this.dy = null;
    this.dt = 1;
    this.starts = { yesStart: 0, cardStart: 0, scrollStart: 0 };
    this.velocityXY = [0, 0];
    this.forcedMomentum = 0;
    this.direction = null;
  }

  decideDirection = () => {
    const { dx, dy } = this;
    const [vx, vy] = this.velocityXY;
    if (Math.abs(vy) > Math.max(Math.abs(vx), 0.1) && Math.abs(dx) < 64) this.direction = VERTICAL;
    if (Math.abs(vx) >= Math.max(Math.abs(vy), 0.1) && Math.abs(dy) < 64) this.direction = HORIZONTAL;
    if (Math.abs(dy) >= 64) this.direction = VERTICAL;
    if (Math.abs(dx) >= 64) this.direction = HORIZONTAL;
    const anim = this.anims[this.target.activeIndex];
    if (this.direction === VERTICAL) anim.yes.setValue(this.starts.yesStart);
    if (this.direction === VERTICAL) anim.ribbonOpacity.setValue(this.starts.yesStart);
    if (this.direction === HORIZONTAL) anim.card.setValue(this.starts.cardStart);
    if (this.direction === HORIZONTAL) anim.anchor.setValue(this.startXY[1] > (window.screen.height * 2) / 3 ? -1 : 1);
  }

  tick = () => {
    console.log('[D]', 'tick');
    if (!this.pendingUpdates) return;
    this.pendingUpdates = false;
    if(!this.updating) return;
    const { h, w } = this.actual;
    const { dx, dy, dt } = this;
    const anim = this.anims[this.target.activeIndex];
    const { card, yes, yesY, scroll, ribbonOpacity } = anim;

    const { yesStart, cardStart, scrollStart } = this.starts;
    const stillDeciding = Math.abs(dx) < 10 && Math.abs(dy) < 10 && dt < 150;
    if (!this.direction && !stillDeciding) {
      this.decideDirection();
    }
    if(!this.direction || this.direction === VERTICAL) {
      // vertical swipe
      const { minCard, maxCard, maxScroll, overScroll } = this.target;
      const position = cardStart * h + scrollStart - dy;
      const cardTarget = clamp(position / h, minCard, maxCard);
      const scrollTarget = clamp(cardTarget < 0 ? 0 : Math.floor(position - cardTarget * h), 0, Math.max(maxScroll - h + overScroll, 0));
      card.setValue(cardTarget);
      scroll.setValue(scrollTarget);
    }

    if (!this.direction || this.direction === HORIZONTAL) {
      // horizontal swipe
      yes.setValue(yesStart + dx / w);

      ribbonOpacity.setValue(clamp(yesStart + dx / w, -1, 1));

      if (this.direction) yesY.setValue(dy);
    }
  }

  // set yesIndices and noIndices to the target of the pan
  // set the target card
  // re-order the list of cards according to lCards and rCards
  handleScope = ({ lCards, rCards, targetCardId }) => {
    const startingCards = this.cards.filter(cardId => cardId !== targetCardId && (lCards.includes(cardId) || rCards.includes(cardId)));
    const targetCards = this.cards.filter(cardId => cardId === targetCardId);
    const newCards = [...startingCards, ...targetCards, this.cards.filter(cardId => !startingCards.includes(cardId) && !targetCards.includes(cardId))];

    this.cards = newCards;

    startingCards.forEach((id, i) => {
      if (rCards.includes(cardId)) {
        this.target.yesIndices.push(i);
      } else {
        this.target.noIndices.push(i);
      }
    })
    this.target.activeIndex = startingCards.length;
  }

  onGlobalMouseMove = event => {
    console.log('[D]', 'onGlobalMouseMove');
    this.handleMove(event);
    event.preventDefault();
    event.stopPropagation();
  }

  onGlobalTouchMove = event => {
    this.handleMove(event.touches[0]);
    event.preventDefault();
  }

  onGlobalMouseUp = event => {
    console.log('[D]', 'onGlobalMouseUp');
    this.handleStop();
    event.preventDefault();
    event.stopPropagation();
  }

  onGlobalTouchEnd = event => {
    this.handleStop();
    event.preventDefault();
  }

  addGlobalEventListeners = () => {
    if (!this.wheelActive) {
      window.addEventListener('mousemove', this.onGlobalMouseMove);
      window.addEventListener('mouseup', this.onGlobalMouseUp);
      window.addEventListener('touchstart', this.onGlobalTouchMove);
      window.addEventListener('touchmove', this.onGlobalTouchMove);
      window.addEventListener('touchend', this.onGlobalTouchEnd);
      window.addEventListener('touchcancel', this.onGlobalTouchEnd);
    }
    this.af = raf(this.tick);
  }

  removeGlobalEventListeners = () => {
    if (!this.wheelActive) {
      window.removeEventListener('mousemove', this.onGlobalMouseMove);
      window.removeEventListener('mouseup', this.onGlobalMouseUp);
      window.removeEventListener('touchstart', this.onGlobalTouchMove);
      window.removeEventListener('touchmove', this.onGlobalTouchMove);
      window.removeEventListener('touchend', this.onGlobalTouchEnd);
      window.removeEventListener('touchcancel', this.onGlobalTouchEnd);
    }
    if (this.af) raf.cancel(this.af);
    this.af = null;
  }

  updateVelocity = ({ clientX, clientY }) => {
    const now = Date.now();
    const [x, y] = this.lastXY;
    const dt = now - this.lastT;
    if (now <= 0) return;
    if (x === clientX && y === clientY) return;

    this.velocityXY = [(clientX - x) / dt, (cleintY - y) / dt];
    this.lastT = now;
    this.dt = this.lastT - this.startT;
    this.lastXY = [clientX, clientY];
  }

  handleStart = ({ clientX, clientY}, targetElement) => {
    if (!this.enabled) return console.error('Pan not enabled');
    if (this.updating) return console.error('Pan invalid start');
    if (!this.anims[this.target.activeIndex]) return console.error('Pan anim not found');

    console.log('Pan start');
    this.reset();
    this.targetElement = targetElement;
    this.updating = true;
    this.pendingUpdates = true;
    this.startXY = [clientX, clientY];
    this.startT = Date.now();
    this.lastXY = [clientX, clientY];
    this.lastT = this.startT;
    this.velocityXY = [0, 0];

    const { yes, ribbonOpacity, card, scroll } = this.anims[this.target.activeIndex];
    return ribbonOpacity.stopAnimation(() => {
      yes.stopAnimation(yesStart => {
        card.stopAnimation(cardStart => {
          scroll.stopAnimation(scrollStart => {
            this.starts.yesStart = yesStart || 0;
            this.starts.cardStart = cardStart || 0;
            this.starts.scrollStart = scrollStart || 0;
            this.addGlobalEventListeners();
          });
        });
      });
    });
  };

  onMouseDown = (event) => {
    console.log('[D]', 'onMouseDown', event);
    this.handleStart(event, 'onMouseDown', event.target);
    event.preventDefault();
    event.stopPropagation();
  }

  onMouseUp = () => {
    console.log('[D]', 'onMouseUp', event);
  }

  onWheel = (event) => {
    console.log('[D]', 'onWheel', event);
  }

  onTouchStart = (event) => {
    console.log('[D]', 'onTouchStart', event);
  }
  listeners = {
    onMouseDown: this.onMouseDown,
    onTouchStart: this.onTouchStart,
    onWheel: this.onWheel,
  }
}

export default Pan;