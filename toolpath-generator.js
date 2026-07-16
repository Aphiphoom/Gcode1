! function(t) {
    "use strict";

    function e(t) {
        let e = 0;
        for (let n = 0; n < t.length; n++) {
            const o = t[n],
                r = t[(n + 1) % t.length];
            e += o.x * r.y - r.x * o.y
        }
        return e / 2
    }

    function n(t) {
        if (t.length > 1) {
            const e = t[0],
                n = t[t.length - 1];
            if (Math.hypot(e.x - n.x, e.y - n.y) < 1e-6) return t.slice(0, -1)
        }
        return t.slice()
    }

    function o(t, e, n, o, r, s, a, c) {
        const l = (t - n) * (s - c) - (e - o) * (r - a);
        if (Math.abs(l) < 1e-9) return null;
        const i = ((t - r) * (s - c) - (e - s) * (r - a)) / l;
        return {
            x: t + i * (n - t),
            y: e + i * (o - e)
        }
    }

    function r(t, e) {
        const o = void 0 !== e ? e : 1e-4,
            r = n(t),
            s = r.length;
        if (s < 3) return t;
        const a = [];
        for (let t = 0; t < s; t++) {
            const e = r[(t + s - 1) % s],
                n = r[t],
                c = r[(t + 1) % s],
                l = (n.x - e.x) * (c.y - e.y) - (n.y - e.y) * (c.x - e.x);
            Math.abs(l) > o && a.push(n)
        }
        return a.length < 3 ? t : (a.push({
            x: a[0].x,
            y: a[0].y
        }), a)
    }

    function s(t, r, s) {
        let a = n(t);
        const c = a.length;
        if (c < 3 || r <= 1e-9) return a.slice();
        e(a) < 0 && (a = a.slice().reverse());
        const l = s ? 1 : -1,
            i = [];
        for (let t = 0; t < c; t++) {
            const e = a[t],
                n = a[(t + 1) % c];
            let o = n.x - e.x,
                s = n.y - e.y;
            const h = Math.hypot(o, s);
            if (h < 1e-9) continue;
            o /= h, s /= h;
            const p = s * l,
                u = -o * l;
            i.push({
                ax: e.x + p * r,
                ay: e.y + u * r,
                bx: n.x + p * r,
                by: n.y + u * r
            })
        }
        const h = [],
            p = i.length;
        for (let t = 0; t < p; t++) {
            const e = i[(t - 1 + p) % p],
                n = i[t],
                r = o(e.ax, e.ay, e.bx, e.by, n.ax, n.ay, n.bx, n.by);
            h.push(r || {
                x: n.ax,
                y: n.ay
            })
        }
        return h.push({
            x: h[0].x,
            y: h[0].y
        }), h
    }

    function a(t, n, r) {
        const s = t.map(t => t.p0);
        let a = t;
        e(s) < 0 && (a = t.slice().reverse().map(t => "line" === t.type ? {
            type: "line",
            p0: t.p1,
            p1: t.p0
        } : {
            type: "arc",
            p0: t.p1,
            p1: t.p0,
            cx: t.cx,
            cy: t.cy,
            r: t.r,
            ccw: !t.ccw
        }));
        const c = r ? 1 : -1,
            l = a.length,
            i = a.map(t => {
                if ("line" === t.type) {
                    let e = t.p1.x - t.p0.x,
                        o = t.p1.y - t.p0.y;
                    const r = Math.hypot(e, o) || 1;
                    e /= r, o /= r;
                    const s = o * c,
                        a = -e * c;
                    return {
                        type: "line",
                        p0: {
                            x: t.p0.x + s * n,
                            y: t.p0.y + a * n
                        },
                        p1: {
                            x: t.p1.x + s * n,
                            y: t.p1.y + a * n
                        }
                    }
                }
                const e = t.r + c * n;
                return {
                    type: "arc",
                    cx: t.cx,
                    cy: t.cy,
                    r: e,
                    ccw: t.ccw,
                    origP0: t.p0,
                    origP1: t.p1
                }
            }),
            h = [];
        for (let t = 0; t < l; t++) {
            const e = i[(t - 1 + l) % l],
                n = i[t];
            if ("line" === e.type && "line" === n.type) {
                const t = o(e.p0.x, e.p0.y, e.p1.x, e.p1.y, n.p0.x, n.p0.y, n.p1.x, n.p1.y);
                h.push(t || n.p0)
            } else if ("arc" === n.type) {
                const t = Math.atan2(n.origP0.y - n.cy, n.origP0.x - n.cx);
                h.push({
                    x: n.cx + n.r * Math.cos(t),
                    y: n.cy + n.r * Math.sin(t)
                })
            } else {
                const t = Math.atan2(e.origP1.y - e.cy, e.origP1.x - e.cx);
                h.push({
                    x: e.cx + e.r * Math.cos(t),
                    y: e.cy + e.r * Math.sin(t)
                })
            }
        }
        const p = [],
            u = [];
        for (let t = 0; t < l; t++) {
            const e = i[t],
                n = h[t],
                o = h[(t + 1) % l];
            if ("line" === e.type) p.push(n);
            else {
                const t = p.length;
                p.push(n);
                const r = Math.atan2(n.y - e.cy, n.x - e.cx);
                let s = Math.atan2(o.y - e.cy, o.x - e.cx) - r;
                e.ccw && s < 0 && (s += 2 * Math.PI), !e.ccw && s > 0 && (s -= 2 * Math.PI);
                const a = 8;
                for (let t = 1; t <= a; t++) {
                    const n = r + s * (t / a);
                    p.push({
                        x: e.cx + e.r * Math.cos(n),
                        y: e.cy + e.r * Math.sin(n)
                    })
                }
                u.push({
                    startIdx: t,
                    endIdx: p.length - 1,
                    cx: e.cx,
                    cy: e.cy,
                    r: e.r,
                    ccw: e.ccw
                })
            }
        }
        return p.push({
            x: p[0].x,
            y: p[0].y
        }), {
            path: p,
            arcRanges: u
        }
    }

    function c(t) {
        let e = 0;
        for (let n = 0; n < t.length - 1; n++) e += Math.hypot(t[n + 1].x - t[n].x, t[n + 1].y - t[n].y);
        return e
    }

    function l(t, e) {
        return "climb" === e ? t.slice().reverse() : t
    }

    function i(t) {
        let e = 0,
            n = 0;
        for (const o of t) e += o.x, n += o.y;
        return {
            x: e / t.length,
            y: n / t.length
        }
    }

    function h(t, e) {
        let n = !1;
        const o = e.length;
        for (let r = 0, s = o - 1; r < o; s = r++) {
            const o = e[r].x,
                a = e[r].y,
                c = e[s].x,
                l = e[s].y;
            a > t.y != l > t.y && t.x < (c - o) * (t.y - a) / (l - a + 1e-12) + o && (n = !n)
        }
        return n
    }

    function p(t) {
        const o = t.length,
            r = t.map(t => n(t)),
            s = r.map(i),
            // ใช้ bounding box area แทน signed area เพื่อให้ concave polygon (ตัว U, L, C)
            // มี "ขนาด" ที่สะท้อนพื้นที่จริงที่ครอบครอง ไม่ใช่ signed polygon area ที่เล็กกว่าความเป็นจริง
            a = r.map(pts => { const xs = pts.map(p => p.x), ys = pts.map(p => p.y); return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)); }),
            c = new Array(o).fill(0);
        for (let t = 0; t < o; t++)
            for (let e = 0; e < o; e++) t !== e && a[e] > a[t] && h(s[t], r[e]) && c[t]++;
        return c
    }

    function u(t) {
        const e = n(t),
            o = e.length;
        if (o < 8) return null;
        let r = 0,
            s = 0;
        for (const t of e) r += t.x, s += t.y;
        r /= o, s /= o;
        const a = e.map(t => Math.hypot(t.x - r, t.y - s)),
            c = a.reduce((t, e) => t + e, 0) / o;
        if (c < 1e-6) return null;
        let l = 0;
        for (const t of a) l = Math.max(l, Math.abs(t - c) / c);
        let i = 0;
        for (let t = 0; t < o; t++) {
            const n = e[t],
                a = e[(t + 1) % o],
                l = (n.x + a.x) / 2,
                h = (n.y + a.y) / 2,
                p = Math.hypot(l - r, h - s);
            i = Math.max(i, Math.abs(p - c) / c)
        }
        return l < .06 && i < .06 ? {
            cx: r,
            cy: s,
            r: c,
            deviation: Math.max(l, i)
        } : null
    }

    function f(t) {
        const e = String(t).toUpperCase().match(/D(\d+(\.\d+)?)/);
        return e ? parseFloat(e[1]) : null
    }

    function y(t, e, n, o) {
        const r = o || Math.max(36, Math.ceil(2 * Math.PI * Math.max(n, .1) / 1.5)),
            s = [];
        for (let o = 0; o <= r; o++) {
            const a = 2 * Math.PI * o / r;
            s.push({
                x: t + n * Math.cos(a),
                y: e + n * Math.sin(a)
            })
        }
        return s
    }

    function x(t, e, n) {
        const o = [],
            r = e - t,
            s = Math.abs(n) || Math.abs(r) || 1,
            a = r < 0 ? -1 : 1;
        let c = t;
        for (; Math.abs(c - t) + s < Math.abs(r) - 1e-6;) c += a * s, o.push(c);
        return o.push(e), o
    }

    function g(t, e, n) {
        const o = [],
            r = c(t);
        if (e <= 0 || r <= 0 || n <= 0) return o;
        for (let t = 0; t < e; t++) {
            const s = r * t / e + r / (2 * e);
            let a = s - n / 2,
                c = s + n / 2;
            o.push({
                start: Math.max(0, a),
                end: Math.min(r, c)
            })
        }
        return o
    }

    function d(t, o, a) {
        const c = r(t),
            l = Math.max(.1, o * (a / 100)),
            i = [];
        let h = 1 / 0,
            p = 1 / 0,
            u = -1 / 0,
            f = -1 / 0;
        for (const t of c) t.x < h && (h = t.x), t.y < p && (p = t.y), t.x > u && (u = t.x), t.y > f && (f = t.y);
        const y = Math.min(u - h, f - p) / 2;
        let x = o / 2,
            g = 1 / 0,
            d = 0;
        for (; d++ < 500 && x <= y + l;) {
            const t = s(c, x, !1);
            if (!t || t.length < 4) break;
            const r = Math.abs(e(n(t)));
            if (r > g + 1e-6) break;
            if (i.push(t), r < o * o) break;
            g = r, x += l
        }
        return i
    }

    function m(t, e, n, o, r) {
        const s = Math.max(.1, o * (r / 100)),
            a = [];
        let c = o / 2,
            l = 0;
        for (; l++ < 500 && c <= n + s;) {
            const r = n - c;
            if (r < o / 2 - 1e-6) {
                r > .05 && a.push({
                    cx: t,
                    cy: e,
                    r: r
                });
                break
            }
            a.push({
                cx: t,
                cy: e,
                r: r
            }), c += s
        }
        return a
    }

    function b(t, e) {
        return t.map(t => ({
            startIdx: e - 1 - t.endIdx,
            endIdx: e - 1 - t.startIdx,
            cx: t.cx,
            cy: t.cy,
            r: t.r,
            ccw: !t.ccw
        }))
    }

    function M(t, e, n, o, c, i, h, p) {
        if (!h) {
            const r = u(t);
            if (r) {
                const t = f(c);
                let s = r.r;
                t && Math.abs(t - 2 * r.r) / t < .08 && (s = t / 2);
                const a = s + (n ? e : -e);
                if (a > .05) {
                    return {
                        path: l(y(r.cx, r.cy, a), o),
                        circleMeta: {
                            cx: r.cx,
                            cy: r.cy,
                            r: a
                        }
                    }
                }
                i.push(`วงกลมใน layer "${c}" เล็กเกินไปสำหรับมีดนี้ (offset เข้าในแล้วรัศมีติดลบ) — ใช้เส้นจุดแทน`)
            }
            if (p && p.length) {
                const t = a(p, e, n);
                if (t.arcRanges.every(t => t.r > .05)) {
                    let e = t.path,
                        n = t.arcRanges;
                    "climb" === o && (n = b(n, e.length), e = e.slice().reverse());
                    const r = function(t, e) {
                        if (!t || t.length < 4 || !e || !e.length) return {
                            path: t,
                            arcRanges: e
                        };
                        const n = Math.hypot(t[0].x - t[t.length - 1].x, t[0].y - t[t.length - 1].y) < 1e-6 ? t.slice(0, -1) : t.slice(),
                            o = n.length;
                        if (o < 4) return {
                            path: t,
                            arcRanges: e
                        };
                        const r = new Array(o).fill(!1);
                        e.forEach(t => {
                            for (let e = t.startIdx; e <= t.endIdx; e++) e >= 0 && e < o && (r[e] = !0)
                        });
                        let s = -1,
                            a = -1;
                        for (let t = 0; t < o; t++) {
                            const e = (t + 1) % o;
                            if (r[t] || r[e]) continue;
                            const c = Math.hypot(n[e].x - n[t].x, n[e].y - n[t].y);
                            c > a && (a = c, s = t)
                        }
                        if (s <= 0) return {
                            path: t,
                            arcRanges: e
                        };
                        const c = s,
                            l = n.slice(c).concat(n.slice(0, c)),
                            i = l.concat([{
                                x: l[0].x,
                                y: l[0].y
                            }]),
                            h = t => ((t - c) % o + o) % o;
                        return {
                            path: i,
                            arcRanges: e.map(t => {
                                const e = h(t.startIdx),
                                    n = h(t.endIdx);
                                return {
                                    startIdx: Math.min(e, n),
                                    endIdx: Math.max(e, n),
                                    cx: t.cx,
                                    cy: t.cy,
                                    r: t.r,
                                    ccw: t.ccw
                                }
                            })
                        }
                    }(e, n);
                    return {
                        path: r.path,
                        circleMeta: null,
                        arcRanges: r.arcRanges
                    }
                }
                i.push(`มุมโค้งใน layer "${c}" เล็กเกินไปสำหรับมีดนี้ (offset แล้วรัศมีติดลบ) — ใช้เส้นจุดแทน`)
            }
        }
        return {
            path: l(s(r(t), e, n), o),
            circleMeta: null
        }
    }

    function I(t) {
        const o = [];
        if (t.forEach((t, e) => {
                t.closed && t.points.length >= 4 && o.push(e)
            }), o.length < 2) return t.slice().sort((t, e) => c(t.points) - c(e.points));
        const r = o.length,
            s = o.map(e => n(t[e].points)),
            a = s.map(pts => { const xs = pts.map(p => p.x), ys = pts.map(p => p.y); return (Math.max(...xs)-Math.min(...xs)) * (Math.max(...ys)-Math.min(...ys)); }),
            l = s.map(i),
            p = new Array(r).fill(-1);
        for (let t = 0; t < r; t++) {
            let e = 1 / 0,
                n = -1;
            for (let o = 0; o < r; o++) t !== o && a[o] > a[t] && a[o] < e && h(l[t], s[o]) && (e = a[o], n = o);
            p[t] = n
        }
        const u = new Array(r),
            f = new Array(r).fill(0);
        for (let t = 0; t < r; t++) {
            let e = t,
                n = 0,
                o = 0;
            for (; - 1 !== p[e] && n++ < 30;) e = p[e], o++;
            u[t] = e, f[t] = o
        }
        const y = {};
        for (let t = 0; t < r; t++) {
            const e = u[t];
            void 0 === y[e] && (y[e] = c(s[e]))
        }
        const x = Object.keys(y).map(Number).sort((t, e) => y[t] - y[e]),
            g = {};
        x.forEach((t, e) => {
            g[t] = e
        });
        const d = Array.from({
                length: r
            }, (t, e) => e).sort((t, e) => g[u[t]] - g[u[e]] || f[e] - f[t] || t - e).map(e => t[o[e]]),
            m = t.filter(t => !(t.closed && t.points.length >= 4));
        return d.concat(m)
    }

    function E(t) {
        if (t.segments) return t.segments;
        let e = n(t.points);
        const o = e;
        e = e.filter((t, e) => {
            const n = o[(e - 1 + o.length) % o.length];
            return Math.hypot(t.x - n.x, t.y - n.y) > 1e-6
        });
        const r = e.length,
            s = [];
        for (let t = 0; t < r; t++) s.push({
            type: "line",
            p0: e[t],
            p1: e[(t + 1) % r]
        });
        return s
    }

    function P(t, e) {
        const n = t.slice(0, -1),
            o = n.length,
            r = {};
        e.forEach(t => {
            r[t.startIdx] = t
        });
        const s = [];
        let a = 0;
        for (; a < o;) {
            const t = r[a];
            if (t) {
                const e = n[t.startIdx],
                    r = n[(t.endIdx + 1) % o];
                s.push({
                    type: "arc",
                    p0: e,
                    p1: r,
                    cx: t.cx,
                    cy: t.cy,
                    r: t.r,
                    ccw: t.ccw
                }), a = t.endIdx + 1
            } else {
                const t = n[a],
                    e = n[(a + 1) % o];
                s.push({
                    type: "line",
                    p0: t,
                    p1: e
                }), a++
            }
        }
        return s
    }

    function k(e) {
        const o = t.MachineConfig && t.MachineConfig.EXCLUDED_LAYERS || [],
            r = e.entities.filter(t => -1 === o.indexOf(t.layer) && t.closed && t.points && t.points.length >= 4);
        if (r.length < 2) return r;
        let s = -1,
            a = -1;
        return r.forEach((t, e) => {
            const o = c(n(t.points));
            o > s && (s = o, a = e)
        }), r.filter((t, e) => e !== a)
    }
    t.ToolpathGenerator = {
        generate: function(e, n, o, r, s) {
            const a = [],
                c = [],
                l = t.MachineConfig && t.MachineConfig.EXCLUDED_LAYERS || ["_ABF_SHEET_BORDER"],
                h = {};
            for (const P of e.entities) - 1 === l.indexOf(P.layer) && (h[P.layer] = h[P.layer] || []).push(P);
            // รวมเส้น cut_inside_<X> เข้ากับ cut_outside_<X> (suffix เดียวกัน) เพื่อคำนวณความซ้อน (nesting)
            // รวมกันทั้งชิ้น ทำให้ทิศ offset ของเส้นซ้อน (เช่น ชิ้นตรงกลางในกรอบรูป) ถูกต้อง และเรียงตัดในสุดก่อน
            // เหมือน logic ของ _ABF_CUTTING_LINES — เงื่อนไข: ต้องมี cut_outside คู่กัน, เปิดใช้งานทั้งคู่,
            // outside เป็น Profile Outside และใช้ Tool เดียวกัน (รัศมี offset ตรงกัน)
            const mergedCutFamilies = new Set();
            for (const _ly of Object.keys(h)) {
                const _mi = _ly.match(/^cut_inside_(.+)$/i);
                if (!_mi) continue;
                const _out = "cut_outside_" + _mi[1];
                if (!h[_out]) continue;
                const _mIn = n[_ly],
                    _mOut = n[_out];
                if (!_mIn || !_mOut) continue;
                if (!1 === _mIn.enabled || !1 === _mOut.enabled) continue;
                if ("Profile Outside" !== _mOut.operation) continue;
                if (_mIn.toolNumber !== _mOut.toolNumber) continue;
                h[_out] = h[_out].concat(h[_ly]);
                delete h[_ly];
                mergedCutFamilies.add(_out)
            }
            const E = "table" === r.z0Mode && parseFloat(r.woodThickness) || 0;
            for (const k of Object.keys(h)) {
                const w = n[k];
                if (!w || !1 === w.enabled || "None" === w.operation) continue;
                const T = o[w.toolNumber];
                if (!T) {
                    c.push(`Layer "${k}" ไม่ได้กำหนด Tool ที่ใช้ได้`);
                    continue
                }
                let R = h[k];
                const v = t.MachineConfig && t.MachineConfig.LOCKED_LAST_LAYER || "_ABF_CUTTING_LINES";
                (k === v || mergedCutFamilies.has(k)) && R.length > 1 && (R = I(R));
                const N = w.operation,
                    D = s(parseFloat(w.depth) || 0),
                    F = x(E, D, T.passDepth),
                    C = {
                        order: null === w.order || void 0 === w.order || "" === w.order ? null : Number(w.order),
                        toolNumber: w.toolNumber
                    };
                let A = null;
                const $ = "Profile Outside" === N || "Profile Inside" === N;
                if ($) {
                    const Z = R.map(t => t.closed && t.points.length >= 4 ? t.points : null),
                        _ = Z.map((t, e) => t ? e : -1).filter(t => -1 !== t);
                    if (_.length > 1) {
                        const O = p(_.map(t => Z[t]));
                        A = {}, _.forEach((t, e) => {
                            A[t] = O[e]
                        })
                    }
                }
                const L = "Profile Outside" === N;
                if ("Mark Square" === N) {
                    const S = R.flatMap(t => t.points || []);
                    if (S.length < 2) {
                        c.push(`Mark Square ต้องมีจุดอย่างน้อย 2 จุด (layer "${k}")`);
                        continue
                    }
                    const V = S.length >= 3 ? S[Math.floor(S.length / 2)] : S[0],
                        Y = (e.bounds.minX + e.bounds.maxX) / 2,
                        U = (e.bounds.minY + e.bounds.maxY) / 2,
                        X = V.x > Y ? 1 : -1,
                        B = V.y > U ? 1 : -1,
                        H = (T.diameter || 6) / 2,
                        j = X * H,
                        q = B * H,
                        z = S.map(t => ({
                            x: t.x + j,
                            y: t.y + q
                        }));
                    a.push({
                        kind: "mark",
                        layer: k,
                        toolNumber: w.toolNumber,
                        path: z,
                        targetZ: D,
                        passes: F,
                        tool: T,
                        ...C
                    });
                    continue
                }
                if ("Drill Corners" === N || "Drill Endpoints" === N) {
                    const G = .1,
                        K = 175,
                        W = [];

                    function J(t, e, n, o) {
                        const r = t * n + e * o,
                            s = Math.hypot(t, e),
                            a = Math.hypot(n, o);
                        return s < 1e-9 || a < 1e-9 ? 180 : 180 * Math.acos(Math.max(-1, Math.min(1, r / (s * a)))) / Math.PI
                    }
                    R.forEach(t => {
                        if (u(t.points)) return;
                        const e = t.points || [];
                        if (e.length < 2) return;
                        const n = t.closed && e.length >= 4;
                        if ("Drill Endpoints" === N) {
                            if (n) return;
                            return W.push({
                                x: e[0].x,
                                y: e[0].y
                            }), void W.push({
                                x: e[e.length - 1].x,
                                y: e[e.length - 1].y
                            })
                        }
                        let o = [];
                        if (t.segments && t.segments.length) {
                            if (t.segments.forEach(t => {
                                    const n = e[t.startIdx];
                                    n && o.push({
                                        x: n.x,
                                        y: n.y
                                    })
                                }), !n) {
                                const n = t.segments[t.segments.length - 1],
                                    r = e[n.endIdx];
                                r && o.push({
                                    x: r.x,
                                    y: r.y
                                })
                            }
                        } else {
                            const t = n ? e.length - 1 : e.length;
                            for (let n = 0; n < t; n++) o.push({
                                x: e[n].x,
                                y: e[n].y
                            })
                        }
                        const r = o.length;
                        if (r < 2) return;
                        const s = T && T.diameter ? T.diameter : 0;
                        if (n) o.forEach(t => W.push({
                            x: t.x,
                            y: t.y
                        }));
                        else
                            for (let t = 1; t < r - 1; t++) {
                                const e = o[t - 1],
                                    n = o[t],
                                    r = o[t + 1],
                                    a = n.x - e.x,
                                    c = n.y - e.y,
                                    l = r.x - n.x,
                                    i = r.y - n.y;
                                if (J(a, c, l, i) < K) {
                                    W.push({
                                        x: n.x,
                                        y: n.y
                                    });
                                    const t = Math.hypot(a, c),
                                        o = Math.hypot(l, i);
                                    t > s && W.push({
                                        x: e.x,
                                        y: e.y
                                    }), o > s && W.push({
                                        x: r.x,
                                        y: r.y
                                    })
                                }
                            }
                    });
                    const Q = [];
                    for (const tt of W) Q.some(t => Math.hypot(t.x - tt.x, t.y - tt.y) < G) || Q.push(tt);
                    Q.forEach(t => {
                        a.push({
                            kind: "drill",
                            layer: k,
                            toolNumber: w.toolNumber,
                            point: t,
                            targetZ: D,
                            passes: F,
                            tool: T,
                            ...C
                        })
                    });
                    continue
                }
                if ("Dogbone" === N) {
                    const et = .5,
                        nt = [];

                    function ot(t, e) {
                        return nt.some(n => {
                            const o = n.bx - n.ax,
                                r = n.by - n.ay,
                                s = o * o + r * r;
                            if (s < 1e-9) return !1;
                            const a = ((t - n.ax) * o + (e - n.ay) * r) / s;
                            return !(a < -.001 || a > 1.001) && Math.hypot(t - (n.ax + a * o), e - (n.ay + a * r)) <= et
                        })
                    }
                    e.entities.forEach(t => {
                        if (!t.layer || t.layer === k) return;
                        const e = t.points || [];
                        for (let t = 0; t < e.length - 1; t++) nt.push({
                            ax: e[t].x,
                            ay: e[t].y,
                            bx: e[t + 1].x,
                            by: e[t + 1].y
                        })
                    }), R.forEach(t => {
                        const e = t.points || [];
                        if (e.length < 2) return;
                        let n = null;
                        const o = () => {
                            n && n.length >= 2 && a.push({
                                kind: "contour",
                                layer: k,
                                toolNumber: w.toolNumber,
                                path: n,
                                closed: !1,
                                targetZ: D,
                                passes: F,
                                tool: T,
                                circleMeta: null,
                                arcRanges: null,
                                tabs: [],
                                tabTopZ: null,
                                cutType: "Profile On Line",
                                ...C
                            }), n = null
                        };
                        for (let t = 0; t < e.length - 1; t++) {
                            const r = e[t],
                                s = e[t + 1];
                            ot((r.x + s.x) / 2, (r.y + s.y) / 2) ? o() : (n || (n = [{
                                x: r.x,
                                y: r.y
                            }]), n.push({
                                x: s.x,
                                y: s.y
                            }))
                        }
                        o()
                    });
                    continue
                }
                R.forEach((t, e) => {
                    if ("Drill" === N) {
                        const e = "CIRCLE" === t.type ? {
                            x: t.cx,
                            y: t.cy
                        } : i(t.points);
                        return void a.push({
                            kind: "drill",
                            layer: k,
                            toolNumber: w.toolNumber,
                            point: e,
                            targetZ: D,
                            passes: F,
                            tool: T,
                            ...C
                        })
                    }
                    const n = t.closed && t.points.length >= 4;
                    let o, s = null,
                        l = null,
                        h = null,
                        p = null;
                    if ("Pocket" === N) {
                        if (!n) return void c.push(`Pocket ต้องเป็นรูปปิด (layer "${k}")`);
                        const e = u(t.points);
                        if (e) {
                            const t = f(k);
                            let n = e.r;
                            t && Math.abs(t - 2 * e.r) / t < .08 && (n = t / 2), p = m(e.cx, e.cy, n, T.diameter, r.pocketStepover || 40), p.length && (h = p.map(t => y(t.cx, t.cy, t.r)))
                        }
                        if (h || (h = d(t.points, T.diameter, r.pocketStepover || 40)), !h.length) return void c.push(`Pocket เล็กเกินไปสำหรับมีด Ø${T.diameter} (layer "${k}")`)
                    } else if ($)
                        if (n) {
                            const a = A && void 0 !== A[e] ? A[e] : 0,
                                i = "Profile Outside" === N && a > 0,
                                h = i && a % 2 == 1 ? !L : L,
                                p = !(!w.tabsEnabled || !n),
                                u = M(t.points, T.diameter / 2, h, r.cutDirection, k, c, p, t.segments);
                            o = u.path, s = u.circleMeta, l = u.arcRanges || null, i && a % 2 == 1 && o && o.length > 1 && (o = o.slice().reverse(), l && l.length && (l = b(l, o.length))), t._nestedCutType = i && a % 2 == 1 ? "Profile Inside" : null
                        } else c.push(`${N} ต้องเป็นรูปปิด — ใช้ On Line แทน (layer "${k}")`), o = t.points.slice();
                    else o = t.points.slice();
                    let x = [];
                    w.tabsEnabled && n && $ && o && (x = g(o, r.tabCount || 4, r.tabWidth || 6));
                    const I = D < 0 ? D + Math.abs(r.tabHeight || 0) : D - Math.abs(r.tabHeight || 0);
                    h ? a.push({
                        kind: "pocket",
                        layer: k,
                        toolNumber: w.toolNumber,
                        rings: h,
                        circleRings: p,
                        targetZ: D,
                        passes: F,
                        tool: T,
                        ...C
                    }) : a.push({
                        kind: "contour",
                        layer: k,
                        toolNumber: w.toolNumber,
                        path: o,
                        closed: n,
                        targetZ: D,
                        passes: F,
                        tool: T,
                        circleMeta: s,
                        arcRanges: l,
                        tabs: x,
                        tabTopZ: I,
                        cutType: t._nestedCutType || N,
                        ...C
                    })
                })
            }
            return {
                operations: a,
                warnings: c
            }
        },
        offsetPolygon: s,
        offsetMixedPath: a,
        buildPasses: x,
        buildTabs: g,
        makePocket: d,
        signedArea: e,
        pathLength: c,
        fitCircle: u,
        diameterFromLayerName: f,
        computeNestingDepths: p,
        pointInPolygon: h,
        generateDoorProfile: function(t, o, r, s, c) {
            const l = [],
                i = [],
                h = [],
                p = r[o.vbitTool],
                u = r[o.formtoolTool];
            if (!p) return i.push("โหมดตีบัวหน้าบาน: ยังไม่ได้เลือกมีด V-bit"), {
                operations: l,
                warnings: i,
                doors: h
            };
            if (!u) return i.push("โหมดตีบัวหน้าบาน: ยังไม่ได้เลือกมีด FormTool"), {
                operations: l,
                warnings: i,
                doors: h
            };
            const f = o.vlineTool ? r[o.vlineTool] : null,
                y = o.borderTool ? r[o.borderTool] : null,
                g = k(t);
            if (!g.length) return i.push("โหมดตีบัวหน้าบาน: ไม่พบกรอบหน้าบานในไฟล์นี้ (เจอแต่กรอบแผ่นไม้ หรือไม่มีเส้นปิดเลย)"), {
                operations: l,
                warnings: i,
                doors: h
            };
            const d = Math.max(0, parseFloat(o.offset) || 0),
                m = Math.max(0, parseFloat(o.depth) || 0),
                b = c(0),
                M = c(m),
                I = "table" === s.z0Mode && parseFloat(s.woodThickness) || 0,
                w = (parseFloat(p.vbitAngle) || 90) * Math.PI / 180,
                T = (parseFloat(p.vbitTipDiameter) || 0) / 2 + m * Math.tan(w / 2),
                R = (parseFloat(u.diameter) || 0) / 2,
                v = f ? c(Math.max(0, parseFloat(o.vlineDepth) || 0)) : null,
                N = y ? c(Math.max(0, parseFloat(o.borderDepth) || 0)) : null,
                D = y ? (parseFloat(y.diameter) || 0) / 2 : 0,
                F = [],
                C = [],
                A = [],
                $ = [];
            g.forEach((t, r) => {
                const s = E(t);
                if (s.length < 3) return void i.push(`หน้าบาน #${r+1}: จุดไม่พอสร้างรูปทรง ข้ามไป`);
                const c = Math.abs(e(n(t.points)));

                function l(t, o, s) {
                    const a = e(n(t));
                    return !(a <= 1e-6 || a >= s) || (i.push(`หน้าบาน #${r+1}: ระยะ offset รวมของ ${o} มากเกินไปจนรูปทรงพลิกกลับ (เกินครึ่งความกว้าง/สูงของหน้าบาน) ข้ามหน้าบานนี้ไป — ลองลดระยะ offset/ความลึก หรือใช้มีดที่มีมุม/ขนาดเล็กลง`), !1)
                }
                const g = a(s, d, !1);
                if (g.path.length < 4 || !l(g.path, "V-line", c)) return;
                const m = Math.abs(e(n(g.path))),
                    k = a(P(g.path, g.arcRanges), T, !1);
                if (k.path.length < 4 || !l(k.path, "V-bit", m)) return;
                const w = Math.abs(e(n(k.path))),
                    L = a(P(k.path, k.arcRanges), R, !1);
                if (L.path.length < 4 || !l(L.path, "FormTool", w)) return;
                const Z = k.path.length - 1,
                    _ = new Array(Z).fill(!1);
                k.arcRanges.forEach(t => {
                    for (let e = t.startIdx; e <= t.endIdx; e++) _[e] = !0;
                    _[(t.endIdx + 1) % Z] = !0
                });
                const O = [];
                for (let t = 0; t < Z; t++) _[t] || O.push(t);
                const S = x(I, M, p.passDepth),
                    V = x(I, M, u.passDepth);
                if (F.push({
                        kind: "doorprofile",
                        layer: `(หน้าบาน #${r+1}) V-bit`,
                        toolNumber: o.vbitTool,
                        tool: p,
                        path: k.path,
                        arcRanges: k.arcRanges,
                        passes: S,
                        spikeIndices: O,
                        surfacePath: g.path,
                        surfaceZ: b
                    }), C.push({
                        kind: "doorprofile",
                        layer: `(หน้าบาน #${r+1}) FormTool`,
                        toolNumber: o.formtoolTool,
                        tool: u,
                        path: L.path,
                        arcRanges: L.arcRanges,
                        passes: V,
                        spikeIndices: null,
                        surfacePath: null,
                        surfaceZ: b
                    }), f) {
                    const t = x(I, v, f.passDepth);
                    A.push({
                        kind: "doorprofile",
                        layer: `(หน้าบาน #${r+1}) V-line`,
                        toolNumber: o.vlineTool,
                        tool: f,
                        path: g.path,
                        arcRanges: g.arcRanges,
                        passes: t,
                        spikeIndices: null,
                        surfacePath: null,
                        surfaceZ: b
                    })
                }
                if (y) {
                    const t = a(s, D, !0);
                    if (t.path.length >= 4) {
                        const e = x(I, N, y.passDepth);
                        $.push({
                            kind: "doorprofile",
                            layer: `(หน้าบาน #${r+1}) ตัดขอบ`,
                            toolNumber: o.borderTool,
                            tool: y,
                            path: t.path,
                            arcRanges: t.arcRanges,
                            passes: e,
                            spikeIndices: null,
                            surfacePath: null,
                            surfaceZ: b
                        })
                    } else i.push(`หน้าบาน #${r+1}: คำนวณเส้นตัดขอบไม่สำเร็จ ข้ามไป`)
                }
                h.push({
                    vLine: g.path,
                    vbitPath: k.path,
                    formtoolPath: L.path
                })
            });
            let L = 1;
            return [F, C, A, $].forEach(t => {
                t.forEach(t => {
                    t.order = L++, l.push(t)
                })
            }), {
                operations: l,
                warnings: i,
                doors: h
            }
        },
        findDoorEntities: k,
        entityToSegments: E,
        segmentsFromPathAndArcs: P
    }
}("undefined" != typeof window ? window : globalThis);
