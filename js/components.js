// Page, chart and dialog components
(() => {
document.addEventListener('alpine:init', () => {
    // Reusable dialog behaviour. Open:  $dispatch('open-dialog', 'id')   Close: $dispatch('close-dialog', 'id') / Esc / backdrop
    Alpine.data('dialog', (id) => ({
        id,
        show: false,
        root: {
            ['@open-dialog.window'](e) {
                if (e.detail === this.id) this.show = true;
            },
            ['@close-dialog.window'](e) {
                if (e.detail === this.id) this.show = false;
            },
            ['@keydown.escape.window']() {
                this.show = false;
            },
        },
    }));
});


document.addEventListener('alpine:init', () => {
    const store = () => Alpine.store('tracker');

    Alpine.data('trackerPage', () => ({
        setup: { name: '', reminderTime: '20:00', startDate: '' },
        enableNotifications: true,
        setupError: '',
        settings: { name: '', reminderTime: '20:00' },
        restartInput: '',
        newHabit: '',
        habitToDelete: null,
        habitToEdit: null,
        editName: '',

        get t() {
            return store();
        },

        init() {
            this.setup.startDate = this.restartInput = this.t.todayStr;

            this.$watch('t.hasStarted', (started) => started && setTimeout(() => this.scrollToToday(), 100));
            setTimeout(() => this.scrollToToday(), 150);

            if (this.t.phase === 'active' && this.t.pending.length) {
                const n = this.t.pending.length;
                this.t.notify({
                    title: this.t.profile.name ? `Welcome back, ${this.t.profile.name}` : 'Welcome back',
                    description: `${n} habit${n === 1 ? '' : 's'} still open today.`,
                });
            }
        },

        /* Setup (replaces the old onboarding page) */
        async begin() {
            const name = this.setup.name.trim();
            if (!name) {
                this.setupError = 'Please tell us your name.';
                return;
            }
            this.setupError = '';
            const t = this.t;
            t.saveProfile({ name, reminderTime: this.setup.reminderTime });
            t.startTracking(this.setup.startDate);
            if (this.enableNotifications) await t.enableReminders();
        },

        openSettings() {
            this.settings = { name: this.t.profile.name, reminderTime: this.t.profile.reminderTime };
            this.$dispatch('open-dialog', 'settings');
        },

        saveSettings() {
            if (!this.settings.name.trim()) return;
            this.t.saveProfile(this.settings);
            this.$dispatch('close-dialog', 'settings');
        },

        get subtitle() {
            const t = this.t;
            if (!t.hasStarted) return 'Set up your month to begin.';
            const range = `${t.start.format('D MMM')} – ${t.end.format('D MMM YYYY')}`;
            const state = {
                upcoming: 'starts soon',
                active: `day ${t.dayNumber} of ${t.totalDays}`,
                finished: 'completed',
            }[t.phase];
            return [t.profile.name, range, state].filter(Boolean).join(' · ');
        },

        preview(dateStr) {
            if (!dateStr) return '';
            const s = dayjs(dateStr);
            return `${s.format('D MMM YYYY')} → ${s.add(1, 'month').subtract(1, 'day').format('D MMM YYYY')} (one month)`;
        },

        // Centre today's column in the (horizontally scrollable) grid, handy on phones
        scrollToToday() {
            const box = this.$refs.grid;
            const th = box?.querySelector('th[data-today]');
            if (!box || !th) return;
            box.scrollLeft = th.offsetLeft - box.clientWidth / 2 + th.offsetWidth / 2;
        },

        openEdit(habit) {
            this.habitToEdit = habit;
            this.editName = habit.name;
            this.$dispatch('open-dialog', 'edit-habit');
        },

        confirmDelete(habit) {
            this.habitToDelete = habit;
            this.$dispatch('open-dialog', 'delete-habit');
        },

        resetEverything() {
            this.t.resetAll();
            this.setup = { name: '', reminderTime: '20:00', startDate: this.t.todayStr };
            this.$dispatch('close-dialog', 'reset-all');
        },
    }));
});

/**
 * Dependency-free SVG line chart. The SVG body is built as a string and injected
 * with x-html (x-for does not work on <template> inside <svg>).
 */
document.addEventListener('alpine:init', () => {
    Alpine.data('progressChart', () => ({
        W: 800,
        H: 300,
        L: 44,
        R: 16,
        T: 16,
        B: 28,
        hover: null,
        palette: ['#18181b', '#2563eb', '#16a34a', '#ea580c', '#9333ea', '#db2777', '#0891b2', '#ca8a04'],

        get t() {
            return Alpine.store('tracker');
        },

        get visible() {
            const hidden = this.t.chart.hidden;
            return this.t.habits.filter((h) => !hidden.includes(h.id));
        },

        get metricHint() {
            return this.t.chart.metric === 'rate'
                ? 'Share of elapsed days you completed each habit.'
                : 'Share of the whole month completed so far.';
        },

        isVisible(id) {
            return !this.t.chart.hidden.includes(id);
        },

        toggle(id) {
            const h = this.t.chart.hidden;
            this.t.setChart({ hidden: h.includes(id) ? h.filter((x) => x !== id) : [...h, id] });
        },

        showAll() {
            this.t.setChart({ hidden: [] });
        },

        hideAll() {
            this.t.setChart({ hidden: this.t.habits.map((h) => h.id) });
        },

        index(id) {
            const i = this.t.habits.findIndex((h) => h.id === id);
            return this.t.habits[i]?.c ?? Math.max(0, i);
        },

        color(id) {
            return this.palette[this.index(id) % this.palette.length];
        },

        px(i) {
            const n = this.t.totalDays;
            return n > 1 ? this.L + (i * (this.W - this.L - this.R)) / (n - 1) : this.L;
        },

        py(v) {
            return this.T + (this.H - this.T - this.B) * (1 - v / 100);
        },

        onMove(e) {
            const t = this.t;
            if (!t.hasStarted) return;
            const rect = this.$refs.svg.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * this.W;
            const n = t.totalDays;
            const step = (this.W - this.L - this.R) / Math.max(n - 1, 1);
            this.hover = Math.min(Math.max(Math.round((x - this.L) / step), 0), n - 1);
        },

        get svg() {
            const t = this.t;
            if (!t.hasStarted) return '';
            const { L, R, T, B, W, H } = this;
            let s = '';

            // y grid + labels
            for (const v of [0, 25, 50, 75, 100]) {
                const y = this.py(v);
                s += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="var(--color-border)" ${v ? 'stroke-dasharray="3 3"' : ''}/>`;
                s += `<text x="${L - 8}" y="${y + 3}" text-anchor="end" font-size="10" fill="var(--color-muted-foreground)">${v}%</text>`;
            }

            // x labels
            const days = t.days;
            days.forEach((d, i) => {
                if (i === 0 || (i + 1) % 5 === 0 || i === days.length - 1) {
                    s += `<text x="${this.px(i)}" y="${H - B + 16}" text-anchor="middle" font-size="10" fill="var(--color-muted-foreground)">${d.num}</text>`;
                }
            });

            // hover guide
            if (this.hover !== null) {
                const x = this.px(this.hover);
                s += `<line x1="${x}" x2="${x}" y1="${T}" y2="${H - B}" stroke="var(--color-foreground)" stroke-opacity="0.25"/>`;
            }

            // series
            for (const h of this.visible) {
                const pts = t.series(h.id);
                if (!pts.length) continue;
                const col = this.color(h.id);
                const dash = this.index(h.id) >= this.palette.length ? 'stroke-dasharray="5 4"' : '';
                const points = pts.map((v, i) => `${this.px(i).toFixed(1)},${this.py(v).toFixed(1)}`).join(' ');
                s += `<polyline fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" ${dash} points="${points}"/>`;
                const last = pts.length - 1;
                s += `<circle cx="${this.px(last)}" cy="${this.py(pts[last])}" r="3.5" fill="${col}"/>`;
                if (this.hover !== null && pts[this.hover] !== undefined) {
                    s += `<circle cx="${this.px(this.hover)}" cy="${this.py(pts[this.hover])}" r="4.5" fill="var(--color-background)" stroke="${col}" stroke-width="2"/>`;
                }
            }
            return s;
        },

        get tip() {
            const t = this.t;
            if (this.hover === null || !t.hasStarted) return null;
            const day = t.days[this.hover];
            if (!day) return null;
            const left = (this.px(this.hover) / this.W) * 100;
            return {
                title: day.full,
                style: `left:${left}%;transform:translateX(${left > 55 ? 'calc(-100% - 12px)' : '12px'});`,
                items: this.visible.map((h) => {
                    const v = t.series(h.id)[this.hover];
                    return {
                        id: h.id,
                        name: h.name,
                        color: this.color(h.id),
                        value: v === undefined ? '–' : `${Math.round(v)}%`,
                    };
                }),
            };
        },
    }));
});
})();
