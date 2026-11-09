// Stores: toasts + tracker (state persisted in localStorage via Alpine $persist)
(() => {
document.addEventListener('alpine:init', () => {
    Alpine.store('toasts', {
        items: [],

        push({ title, description = '', variant = 'default', duration = 4500 }) {
            const id = Date.now() + Math.random();
            this.items.push({ id, title, description, variant });
            setTimeout(() => this.dismiss(id), duration);
        },

        dismiss(id) {
            this.items = this.items.filter((t) => t.id !== id);
        },
    });
});


const FMT = 'YYYY-MM-DD';
const DEFAULT_HABITS = ['Eat Breakfast', 'Eat Lunch', 'Drink water'];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

document.addEventListener('alpine:init', () => {
    const toast = (opts) => Alpine.store('toasts').push(opts);

    Alpine.store('tracker', {
        /* ------------------------------------------------------------------
         | Persisted in localStorage (Alpine $persist). No backend involved.
         * ----------------------------------------------------------------*/
        profile: Alpine.$persist({ name: '', reminderTime: '20:00', motivation: '' }).as('ht:profile'),
        startDate: Alpine.$persist('').as('ht:start-date'),
        habits: Alpine.$persist([]).as('ht:habits'), // [{ id, name }]
        log: Alpine.$persist({}).as('ht:log'), // { [habitId]: { 'YYYY-MM-DD': true } }
        chart: Alpine.$persist({ hidden: [], metric: 'progress' }).as('ht:chart'),
        reminders: Alpine.$persist({ enabled: false, lastSent: '' }).as('ht:reminders'),
        debugDate: Alpine.$persist('').as('ht:debug-date'),

        /* Runtime only */
        clock: Date.now(),
        permission: typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',

        boot() {
            // Service worker = reliable system notifications on mobile (needs https or localhost)
            if ('serviceWorker' in navigator && window.isSecureContext && window.HabitConfig?.sw) {
                navigator.serviceWorker.register(window.HabitConfig.sw).catch(() => {});
            }
            setInterval(() => this.checkReminder(), 30_000);
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden) this.checkReminder();
            });
            this.checkReminder();
        },

        /* ------------------------------------------------------------------
         | Dates
         * ----------------------------------------------------------------*/
        get debug() {
            return Boolean(window.HabitConfig?.debug);
        },

        get today() {
            void this.clock; // re-evaluate when the clock ticks (midnight rollover)
            return this.debug && this.debugDate ? dayjs(this.debugDate) : dayjs();
        },

        get todayStr() {
            return this.today.format(FMT);
        },

        get hasProfile() {
            return this.profile.name.trim().length > 0;
        },

        get hasStarted() {
            return Boolean(this.startDate);
        },

        get start() {
            return dayjs(this.startDate);
        },

        // One month from the start date: 8 Nov -> 7 Dec
        get end() {
            return this.start.add(1, 'month').subtract(1, 'day');
        },

        get totalDays() {
            return this.hasStarted ? this.end.diff(this.start, 'day') + 1 : 0;
        },

        // Days elapsed in the period, including today (0 before start, totalDays after end)
        get elapsed() {
            if (!this.hasStarted) return 0;
            const n = this.today.startOf('day').diff(this.start, 'day') + 1;
            return Math.min(Math.max(n, 0), this.totalDays);
        },

        get dayNumber() {
            return this.elapsed;
        },

        get phase() {
            if (!this.hasStarted) return 'unset';
            const t = this.todayStr;
            if (t < this.startDate) return 'upcoming';
            if (t > this.end.format(FMT)) return 'finished';
            return 'active';
        },

        get days() {
            if (!this.hasStarted) return [];
            const today = this.todayStr;
            return Array.from({ length: this.totalDays }, (_, i) => {
                const d = this.start.add(i, 'day');
                const date = d.format(FMT);
                return {
                    i,
                    date,
                    num: d.date(),
                    label: i === 0 || d.date() === 1 ? d.format('MMM') : d.format('dd'),
                    full: d.format('dddd, D MMMM YYYY'),
                    isToday: date === today,
                    isFuture: date > today,
                };
            });
        },

        upcoming(n = 7) {
            return Array.from({ length: n }, (_, i) => {
                const d = this.today.startOf('day').add(i + 1, 'day');
                return { date: d.format(FMT), label: d.format('ddd D MMM') };
            });
        },

        /* ------------------------------------------------------------------
         | Profile / tracker lifecycle
         * ----------------------------------------------------------------*/
        saveProfile(p) {
            this.profile = {
                name: p.name.trim(),
                reminderTime: p.reminderTime || '20:00',
            };
        },

        startTracking(date) {
            if (!date) return false;
            this.startDate = date;
            this.log = {};
            if (!this.habits.length) {
                this.habits = DEFAULT_HABITS.map((name, c) => ({ id: uid(), name, c }));
            }
            toast({
                title: 'Tracker started',
                description: `${dayjs(date).format('D MMM')} → ${dayjs(date).add(1, 'month').subtract(1, 'day').format('D MMM YYYY')}`,
            });
            return true;
        },

        resetAll() {
            this.profile = { name: '', reminderTime: '20:00', motivation: '' };
            this.startDate = '';
            this.habits = [];
            this.log = {};
            this.chart = { hidden: [], metric: 'progress' };
            this.reminders = { enabled: false, lastSent: '' };
            this.debugDate = '';
        },

        /* ------------------------------------------------------------------
         | Habits & check-ins
         * ----------------------------------------------------------------*/
        addHabit(name) {
            name = (name || '').trim();
            if (!name) return false;
            if (this.habits.some((h) => h.name.toLowerCase() === name.toLowerCase())) {
                toast({ title: 'Habit already exists', description: name, variant: 'destructive' });
                return false;
            }
            this.habits = [...this.habits, { id: uid(), name, c: this.nextColor() }];
            toast({ title: 'Habit created', description: name });
            return true;
        },

        renameHabit(id, name) {
            name = (name || '').trim();
            if (!name || !this.habits.some((h) => h.id === id)) return false;
            if (this.habits.some((h) => h.id !== id && h.name.toLowerCase() === name.toLowerCase())) {
                toast({ title: 'Habit already exists', description: name, variant: 'destructive' });
                return false;
            }
            this.habits = this.habits.map((h) => (h.id === id ? { ...h, name } : h));
            toast({ title: 'Habit renamed', description: name });
            return true;
        },

        // Stable chart colour per habit (survives re-ordering / deleting)
        nextColor() {
            const used = new Set(this.habits.map((h) => h.c));
            let c = 0;
            while (used.has(c)) c++;
            return c;
        },

        // Called by x-sort after a drag: move habit `id` to index `pos`
        moveHabit(id, pos) {
            const from = this.habits.findIndex((h) => h.id === id);
            if (from < 0) return;
            const next = [...this.habits];
            const [item] = next.splice(from, 1);
            next.splice(Number(pos), 0, item);
            this.habits = next;
        },

        removeHabit(id) {
            this.habits = this.habits.filter((h) => h.id !== id);
            const { [id]: _removed, ...rest } = this.log;
            this.log = rest;
            this.setChart({ hidden: this.chart.hidden.filter((x) => x !== id) });
        },

        isDone(id, date) {
            return Boolean(this.log[id]?.[date]);
        },

        toggle(id, date) {
            if (date > this.todayStr) {
                toast({ title: 'Not yet', description: "You can't check off a future day.", variant: 'destructive' });
                return;
            }
            const next = { ...(this.log[id] ?? {}) };
            if (next[date]) delete next[date];
            else next[date] = true;
            this.log = { ...this.log, [id]: next };

            if (next[date] && date === this.todayStr && this.pending.length === 0) {
                this.notify({ title: 'All done for today', description: `Great work${this.profile.name ? ', ' + this.profile.name : ''}.` });
            }
        },

        /* ------------------------------------------------------------------
         | Stats
         * ----------------------------------------------------------------*/
        get pending() {
            const d = this.todayStr;
            return this.habits.filter((h) => !this.isDone(h.id, d));
        },

        get todayDone() {
            return this.habits.length - this.pending.length;
        },

        doneCount(id) {
            return Object.keys(this.log[id] ?? {}).filter((d) => d <= this.todayStr).length;
        },

        streak(id) {
            let d = this.today.startOf('day');
            if (!this.isDone(id, d.format(FMT))) d = d.subtract(1, 'day');
            let n = 0;
            while (this.isDone(id, d.format(FMT))) {
                n++;
                d = d.subtract(1, 'day');
            }
            return n;
        },

        get bestStreak() {
            return Math.max(0, ...this.habits.map((h) => this.streak(h.id)));
        },

        get overallPercent() {
            const possible = this.elapsed * this.habits.length;
            if (!possible) return 0;
            const done = this.habits.reduce((sum, h) => sum + this.doneCount(h.id), 0);
            return Math.round((done / possible) * 100);
        },

        /**
         * Cumulative series for the chart, one value per elapsed day.
         *  progress -> % of the whole month completed so far
         *  rate     -> % of elapsed days completed
         */
        series(id) {
            const days = this.days;
            const n = this.totalDays;
            const upto = Math.min(this.elapsed, n);
            const out = [];
            let done = 0;
            for (let i = 0; i < upto; i++) {
                if (this.isDone(id, days[i].date)) done++;
                out.push(this.chart.metric === 'rate' ? (done / (i + 1)) * 100 : (done / n) * 100);
            }
            return out;
        },

        setChart(patch) {
            this.chart = { ...this.chart, ...patch };
        },

        /* ------------------------------------------------------------------
         | Notifications (in-app toasts + browser Notification API)
         * ----------------------------------------------------------------*/
        notify({ title, description = '', variant = 'default', system = false }) {
            toast({ title, description, variant });
            if (system && this.reminders.enabled && this.permission === 'granted') {
                this.showSystem(title, description);
            }
        },

        async showSystem(title, body) {
            const opts = { body, tag: 'habit-tracker' };
            try {
                const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
                if (reg?.active) return await reg.showNotification(title, opts);
                new Notification(title, opts);
            } catch (e) {
                console.warn('System notification failed:', e);
            }
        },

        async enableReminders() {
            this.reminders = { ...this.reminders, enabled: true };
            if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
                this.permission = await Notification.requestPermission();
            }
            const at = this.profile.reminderTime;
            if (this.permission === 'granted') {
                toast({ title: 'Reminders on', description: `We'll nudge you daily at ${at} while the app is open.` });
            } else {
                toast({
                    title: 'Reminders on (in-app only)',
                    description: 'Browser notifications are blocked or unsupported, so reminders show inside the page.',
                });
            }
        },

        disableReminders() {
            this.reminders = { ...this.reminders, enabled: false };
            toast({ title: 'Reminders off' });
        },

        checkReminder(force = false) {
            this.clock = Date.now();

            if (!force) {
                if (!this.reminders.enabled || this.phase !== 'active') return;
                if (dayjs().format('HH:mm') < this.profile.reminderTime) return;
                if (this.reminders.lastSent === this.todayStr) return;
            }

            const pending = this.pending;
            if (!pending.length) {
                if (force) this.notify({ title: 'Nothing pending', description: 'Every habit is checked for today.' });
                return;
            }

            if (!force) this.reminders = { ...this.reminders, lastSent: this.todayStr };
            const n = pending.length;
            this.notify({
                title: `${this.profile.name || 'Hey'}, ${n} habit${n === 1 ? '' : 's'} left today`,
                description: pending.map((h) => h.name).join(', '),
                system: true,
            });
        },

        /* ------------------------------------------------------------------
         | Debug helpers (no-ops unless HABIT_DEBUG=true)
         * ----------------------------------------------------------------*/
        debugSet(date) {
            if (!this.debug || !date) return;
            this.debugDate = date;
            this.clock = Date.now();
        },

        debugShift(days) {
            this.debugSet(this.today.startOf('day').add(days, 'day').format(FMT));
        },

        debugReset() {
            if (!this.debug) return;
            this.debugDate = '';
            this.clock = Date.now();
        },

        debugFillRandom() {
            if (!this.debug || !this.hasStarted) return;
            const next = {};
            for (const h of this.habits) {
                next[h.id] = {};
                for (const d of this.days) {
                    if (!d.isFuture && Math.random() < 0.65) next[h.id][d.date] = true;
                }
            }
            this.log = next;
        },

        debugClearLog() {
            if (this.debug) this.log = {};
        },
    });

    Alpine.store('tracker').boot();
});
})();
