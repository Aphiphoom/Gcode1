/* =============================================================================
 * gcode-generator.js (v3)
 * -----------------------------------------------------------------------------
 * เปลี่ยนจากเดิม (v2):
 *  - ตัดระบบ phase 1/phase 2 ออกทั้งหมด — จัดลำดับใหม่ตาม "ชื่อ Layer + เลขลำดับ"
 *    ที่กรอกไว้ในหน้า Layer Mapping (ดู orderOperations() ด้านล่าง)
 *  - ตัด G4 P2 ออกหลังคำสั่งเปิดสปินเดิล
 *  - Pocket: ไม่ยกมีดขึ้นเลยตลอดกระบวนการ (ทุก ring ทุก pass) จนกว่าจะเสร็จสมบูรณ์
 *  - รองรับ circleMeta: ถ้า operation ตรวจพบว่าเป็นวงกลมจริง (และไม่มี tabs) จะออก
 *    คำสั่ง G2/G3 (ส่วนโค้งสมบูรณ์) แทนการเดิน G1 ทีละจุด
 * ========================================================================== */

(function (global) {
  'use strict';

  function fmt(n) {
    if (Math.abs(n) < 1e-9) n = 0;
    let s = n.toFixed(3);
    s = s.replace(/\.?0+$/, '');
    return s === '' || s === '-' ? '0' : s;
  }

  function fillTemplate(tpl, toolNumber, toolName) {
    return tpl.replace(/\{tool\}/g, toolNumber).replace(/\{toolName\}/g, toolName || '');
  }

  function pathLength(pts) {
    let L = 0;
    for (let i = 0; i < pts.length - 1; i++) L += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    return L;
  }

  /* ---------------------------------------------------------------------------
   * สร้างเส้นทางที่ลง Z แบบ "ราย 45 องศา" ตามแนวเส้นทางจริง (ไม่ใช่ดิ่งตรง)
   * เดินไปตาม path สะสมระยะทาง ระยะแนวนอนที่ใช้ ramp = |toZ-fromZ| (มุม 45° จึง
   * แนวนอน=แนวตั้งพอดี) เมื่อถึงระยะนั้นแล้ว Z จะเท่ากับ toZ ตลอดส่วนที่เหลือ
   * ถ้า path สั้นกว่าระยะ ramp ที่ต้องการ (ชิ้นงานเล็กมาก) จะ clamp ให้จบที่ปลาย
   * path พอดี (ลาดชันกว่า 45° เล็กน้อยในกรณีนี้ แทนการวนหลายรอบเพื่อความง่าย)
   * คืนอาเรย์ [{x,y,z}, ...] จุดแรก = จุดเริ่ม path ที่ความสูง fromZ
   * ------------------------------------------------------------------------- */
  function rampedPath(path, fromZ, toZ) {
    const rampDist = Math.abs(toZ - fromZ);
    const out = [{ x: path[0].x, y: path[0].y, z: fromZ }];
    if (rampDist < 1e-6) {
      for (let i = 1; i < path.length; i++) out.push({ x: path[i].x, y: path[i].y, z: toZ });
      return out;
    }
    const total = pathLength(path);
    const effectiveRampDist = Math.min(rampDist, Math.max(total, 1e-6)); // กันกรณี path สั้นกว่าระยะ ramp
    let acc = 0;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      const segLen = Math.hypot(b.x - a.x, b.y - a.y);
      if (segLen < 1e-9) continue;
      const accBefore = acc, accAfter = acc + segLen;
      if (accAfter <= effectiveRampDist) {
        const z = fromZ + (toZ - fromZ) * (accAfter / effectiveRampDist);
        out.push({ x: b.x, y: b.y, z });
      } else if (accBefore >= effectiveRampDist) {
        out.push({ x: b.x, y: b.y, z: toZ });
      } else {
        const t = (effectiveRampDist - accBefore) / segLen;
        const mx = a.x + t * (b.x - a.x), my = a.y + t * (b.y - a.y);
        out.push({ x: mx, y: my, z: toZ });
        out.push({ x: b.x, y: b.y, z: toZ });
      }
      acc = accAfter;
    }
    return out;
  }

  function tabbedPath(path, tabs, zCut, tabTopZ) {
    const cutGoesNegative = zCut < 0 || tabTopZ < 0;
    const isDeeper = cutGoesNegative ? (zCut < tabTopZ - 1e-6) : (zCut > tabTopZ + 1e-6);

    if (!tabs || !tabs.length || !isDeeper) {
      return path.map(p => ({ x: p.x, y: p.y, z: zCut }));
    }
    const inTab = (d) => tabs.some(t => d >= t.start - 1e-6 && d <= t.end + 1e-6);

    const out = [];
    let acc = 0;
    out.push({ x: path[0].x, y: path[0].y, z: inTab(0) ? tabTopZ : zCut });
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      const segLen = Math.hypot(b.x - a.x, b.y - a.y);
      if (segLen < 1e-9) continue;
      const cuts = [];
      for (const t of tabs) {
        for (const edge of [t.start, t.end]) {
          if (edge > acc + 1e-6 && edge < acc + segLen - 1e-6) cuts.push(edge);
        }
      }
      cuts.sort((p, q) => p - q);
      for (const c of cuts) {
        const tt = (c - acc) / segLen;
        const x = a.x + tt * (b.x - a.x), y = a.y + tt * (b.y - a.y);
        out.push({ x, y, z: inTab(c) ? tabTopZ : zCut });
      }
      acc += segLen;
      out.push({ x: b.x, y: b.y, z: inTab(acc) ? tabTopZ : zCut });
    }
    return out;
  }

  /* ---------------------------------------------------------------------------
   * พื้นที่ของ "ชิ้นงาน" ที่ layer นี้ตัด — ใช้เรียงลำดับเล็กก่อน-ใหญ่ทีหลัง
   * คืนพื้นที่ของ contour ที่ใหญ่ที่สุดใน layer (เส้นตัดนอกของชิ้นงานหลัก) — drill/pocket
   * ที่ไม่มี path คืน 0 (ถือว่าเล็กสุด มาก่อน) เพื่อไม่ให้ดันไปท้ายโดยไม่ตั้งใจ
   * ------------------------------------------------------------------------- */
  function layerCutArea(ops) {
    let maxArea = 0;
    for (const op of ops) {
      const a = opCutArea(op);
      if (a > maxArea) maxArea = a;
    }
    return maxArea;
  }

  // ตัดจุดปิดซ้ำหัว-ท้ายออกถ้ามี (เผื่อ signedArea คำนวณเพี้ยนจากจุดซ้ำ)
  function stripClosingLocal(pts) {
    if (pts.length > 1) {
      const a = pts[0], b = pts[pts.length - 1];
      if (Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9) return pts.slice(0, -1);
    }
    return pts;
  }

  /* ---------------------------------------------------------------------------
   * จัดลำดับ operations ตาม "ชื่อ Layer" — แทนที่ระบบ phase เดิมทั้งหมด
   *  1) Layer ที่ล็อกท้ายสุด (เช่น _ABF_CUTTING_LINES) ไปอยู่ท้ายสุดเสมอ
   *  2) Layer ที่กรอกเลขลำดับ มาก่อนเสมอ เรียงน้อย->มาก
   *  3) Layer ที่ไม่กรอกเลขลำดับ ตามมาทีหลัง เรียงเลขมีดมาก->น้อย
   *  4) ไม่จัดกลุ่มลดการเปลี่ยนมีด — เรียงตามลำดับเลเยอร์เป๊ะ ๆ เป็นหลัก
   * ------------------------------------------------------------------------- */
  function orderOperations(operations, machine) {
    const lockedLayer = (global.MachineConfig && global.MachineConfig.LOCKED_LAST_LAYER) || '_ABF_CUTTING_LINES';

    const groups = {};
    const layerOrder = [];
    for (const op of operations) {
      if (!groups[op.layer]) { groups[op.layer] = []; layerOrder.push(op.layer); }
      groups[op.layer].push(op);
    }

    const locked = [];
    const explicit = [];
    const unfilled = [];

    for (const layerName of layerOrder) {
      if (layerName === lockedLayer) { locked.push(layerName); continue; }
      const ops = groups[layerName];
      const orderVal = ops[0].order;
      if (orderVal !== null && orderVal !== undefined && !Number.isNaN(orderVal)) {
        explicit.push({ layerName, order: orderVal });
      } else {
        unfilled.push({ layerName, toolNumber: ops[0].toolNumber });
      }
    }

    explicit.sort((a, b) => a.order - b.order);
    // เลขมีดเดียวกัน: Profile Outside (ตัดแยกชิ้นงานออกจากแผ่น) ต้องอยู่ท้ายกลุ่มมีดนั้นเสมอ
    // กันกรณี Pocket/Drill/Inside ที่ใช้มีดเดียวกันแต่ไม่ได้กรอกลำดับ ดันถูกตัดทีหลังการ
    // ตัดนอกที่ทำให้ชิ้นงานหลุดจากแผ่นไปแล้ว (ตำแหน่งเพี้ยน/ชิ้นงานขยับได้)
    //
    // และในกลุ่ม Profile Outside ที่มีดเดียวกันด้วยกันเอง: เรียง "ชิ้นเล็กก่อน-ใหญ่ทีหลัง"
    // (พื้นที่ภายในเส้นตัดนอกน้อย -> มาก) เพราะเมื่อตัดชิ้นใหญ่หลุดออกไปก่อน ชิ้นเล็กที่ยัง
    // ติดอยู่ในแผ่นอาจเสียการรองรับ/ขยับได้ ตัดชิ้นเล็กให้เสร็จก่อนปลอดภัยกว่า
    unfilled.sort((a, b) => {
      if (b.toolNumber !== a.toolNumber) return b.toolNumber - a.toolNumber;
      const aOut = groups[a.layerName][0].cutType === 'Profile Outside' ? 1 : 0;
      const bOut = groups[b.layerName][0].cutType === 'Profile Outside' ? 1 : 0;
      if (aOut !== bOut) return aOut - bOut;
      // ถึงตรงนี้แปลว่ามีดเดียวกัน + เป็น Profile Outside ทั้งคู่ (หรือไม่ใช่ทั้งคู่) -> เรียงตามขนาด
      return layerCutArea(groups[a.layerName]) - layerCutArea(groups[b.layerName]);
    });

    const finalLayerNames = explicit.map(e => e.layerName)
      .concat(unfilled.map(u => u.layerName))
      .concat(locked);

    return finalLayerNames.map(layerName => {
      const ops = groups[layerName];
      // เรียง ops ภายใน layer เดียวกันด้วย — สำคัญมากเพราะไฟล์จริงมักรวม Profile Outside
      // ของชิ้นงานหลายชิ้นไว้ใน layer เดียว (เช่น cut_outside_18) การเรียงระดับ layer
      // อย่างเดียวจึงไม่พอ ต้องเรียง "ชิ้นเล็กก่อน-ใหญ่ทีหลัง" ที่ระดับ op ด้วย
      const sortedOps = sortOpsWithinLayer(ops, layerName, machine);
      return { layerName, toolNumber: ops[0].toolNumber, tool: ops[0].tool, ops: sortedOps };
    });
  }

  /* ---------------------------------------------------------------------------
   * เรียง operations ภายใน layer เดียวกัน:
   *   - แยก contour ที่เป็น Profile Outside ออกมาเรียงตามพื้นที่ (เล็ก->ใหญ่) แล้ววางท้าย
   *   - op อื่น ๆ (drill/pocket/Profile Inside/OnLine) คงลำดับเดิมไว้ด้านหน้า
   *   - เหตุผลเดียวกับการเรียงระดับ layer: ตัดชิ้นเล็กที่ยังมีแผ่นรองรับให้เสร็จก่อน
   *     ค่อยตัดชิ้นใหญ่ (และตัดนอกที่ทำให้ชิ้นหลุดควรอยู่ท้ายสุดของ layer เสมอ)
   * ------------------------------------------------------------------------- */
  function sortOpsWithinLayer(ops, layerName, machine) {
    // แยกงาน Profile ที่ตัดทะลุ (Outside/Inside/OnLine ที่ targetZ <= 0) ออกจากงานอื่น
    const throughCuts = [];
    const others = [];
    for (const op of ops) {
      const isProfile = op.kind === 'contour' &&
        (op.cutType === 'Profile Outside' || op.cutType === 'Profile Inside');
      const isThrough = typeof op.targetZ === 'number' && op.targetZ <= 0.05;
      if (isProfile && isThrough) throughCuts.push(op);
      else others.push(op);
    }

    if (throughCuts.length === 0) return ops; // ไม่มีงานตัดทะลุ คืนลำดับเดิม

    const threshold = parseFloat((machine || {}).smallPartThreshold) || 0;
    if (threshold <= 0 || throughCuts.length < 2) {
      // threshold = 0: ปิดฟีเจอร์ ไม่เพิ่ม preFinal ใดเลย
      // throughCuts.length < 2: มีแค่ 1 ชิ้น ยังต้องเช็ค narrow ก่อนเพิ่ม preFinal
      if (threshold <= 0) return others.concat(throughCuts);
      const processed = throughCuts.map(op =>
        opNarrowSide(op) < threshold ? applySmallPartPass(op, machine) : op
      );
      return others.concat(processed);
    }

    // แบ่งกลุ่ม: ด้านแคบ < threshold = "เล็ก"
    const small = [], large = [];
    for (const op of throughCuts) {
      (opNarrowSide(op) < threshold ? small : large).push(op);
    }
    small.sort((a, b) => opNarrowSide(a) - opNarrowSide(b));
    large.sort((a, b) => opCutArea(a) - opCutArea(b));

    const smallWithPass = small.map(op => applySmallPartPass(op, machine));
    return others.concat(smallWithPass).concat(large);
  }
  // นิยาม "ทะลุ": targetZ <= 0 (ถึงพื้นโต๊ะหรือต่ำกว่า ตาม z0Mode=table convention)
  // ครอบคลุมทุก Profile ชนิด (Outside/Inside/OnLine) ไม่ hardcode ชื่อ layer
  function isThroughCutGroup(ops) {
    return ops.some(op =>
      op.kind === 'contour' &&
      op.cutType && (op.cutType === 'Profile Outside' || op.cutType === 'Profile Inside') &&
      typeof op.targetZ === 'number' && op.targetZ <= 0.05 // เผื่อ floating point เล็กน้อย
    );
  }

  // คำนวณ bounding box แล้วคืนค่า "ด้านแคบที่สุด" ของชิ้นงาน
  // วิธีนี้ตรงตาม spec: ตีกรอบ path ทั้งเส้นก่อน แล้วค่อยวัดว่ากรอบนั้นกว้าง/ยาวแค่ไหน
  // ไม่ได้ดูว่าเส้นใดเส้นหนึ่งสั้น (เพราะชิ้นงานอาจมีรูปทรงโค้ง/หยัก แต่กรอบยังใหญ่พอ)
  function opNarrowSide(op) {
    if (op.kind !== 'contour' || !op.path || op.path.length < 2) return Infinity;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of op.path) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    const w = maxX - minX, h = maxY - minY;
    return Math.min(w, h);
  }

  // แทรก preFinal pass ใน op ของชิ้นเล็ก:
  //   passes = [...passesBefore, finalZ] → [...passesBefore, preFinalZ, finalZ]
  //   ไม่ mutate op เดิม — คืน op ใหม่ที่ copy passes แล้ว
  function applySmallPartPass(op, machine) {
    const finalPassThickness = parseFloat((machine || {}).smallPartFinalPass) || 0;
    if (finalPassThickness <= 0 || !op.passes || op.passes.length < 1) return op;
    const passes = op.passes;
    const finalZ = passes[passes.length - 1]; // Z ของรอบสุดท้าย (realZ ติดลบ = ทะลุ)
    const preFinalZ = finalZ + finalPassThickness; // สูงกว่า finalZ finalPassThickness mm
    // preFinalZ ต้องอยู่ระหว่าง pass ก่อนหน้ากับ finalZ:
    //   - ถ้า preFinalZ >= 0 แปลว่าเหนือผิวไม้ ไม่ต้องตัดรอบนี้ (ยังไม่แตะเนื้อไม้)
    //   - ถ้า passes[-2] มีอยู่และ preFinalZ <= passes[-2] แปลว่า pass ก่อนหน้าลึกกว่า
    //     preFinal อยู่แล้ว ไม่ต้องแทรก (จะทำให้ Z ขึ้นสูง = wrong direction)
    const prevPass = passes.length >= 2 ? passes[passes.length - 2] : null;
    if (preFinalZ <= finalZ) return op; // preFinalZ ต้องสูงกว่า finalZ เสมอ (กัดน้อยกว่า)
    // block เฉพาะเมื่อ pass ก่อนหน้าลึกกว่า preFinal (จะทำให้ Z ต้องขึ้นสูง = wrong direction)
    if (prevPass !== null && prevPass < preFinalZ) return op;
    const newPasses = passes.slice(0, -1).concat([preFinalZ, finalZ]);
    return Object.assign({}, op, { passes: newPasses, isSmallPart: true });
  }

  // พื้นที่ของ contour op เดียว (ใช้เรียงขนาดชิ้นงานระดับ op + layerCutArea)
  function opCutArea(op) {
    if (op.kind !== 'contour' || !op.path || op.path.length < 3) return 0;
    return Math.abs(signedAreaLocal(stripClosingLocal(op.path)));
  }

  // signedArea แบบโลคัล (ไม่พึ่ง ToolpathGenerator) เผื่อโหลดสคริปต์คนละลำดับ
  function signedAreaLocal(pts) {
    let a = 0;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      a += p.x * q.y - q.x * p.y;
    }
    return a / 2;
  }

  /* ---------------------------------------------------------------------------
   * ฟังก์ชันหลัก: generate(job, config) -> { gcode, stats }
   * ------------------------------------------------------------------------- */
  function generate(job, config) {
    const { machine, header, footer, toolChange } = config;
    const lines = [];
    const z0Offset = (machine.z0Mode === 'table') ? (parseFloat(machine.woodThickness) || 0) : 0;
    const safeZ = parseFloat(machine.safeZ) + z0Offset;
    const clearance = parseFloat(machine.rapidClearance || 3) + z0Offset;
    let stats = { rapidMM: 0, cutMM: 0, lineCount: 0, toolChanges: 0 };
    let lastTool = null;
    let cur = { x: null, y: null, z: null };

    const emit = (s) => lines.push(s);
    const blank = () => { if (lines.length && lines[lines.length - 1] !== '') lines.push(''); };

    function rapid(x, y, z) {
      let s = 'G0';
      if (x !== undefined) s += ' X' + fmt(x);
      if (y !== undefined) s += ' Y' + fmt(y);
      if (z !== undefined) s += ' Z' + fmt(z);
      emit(s); trackMove(x, y, z, true);
    }
    function feed(x, y, z, f) {
      let s = 'G1';
      if (x !== undefined) s += ' X' + fmt(x);
      if (y !== undefined) s += ' Y' + fmt(y);
      if (z !== undefined) s += ' Z' + fmt(z);
      if (f !== undefined) s += ' F' + fmt(f);
      emit(s); trackMove(x, y, z, false);
    }
    // วงกลมเต็มวง 1 รอบ จาก fromZ ลง/ขึ้นไปที่ toZ ตลอดการหมุน 360° (helix) — ถ้า
    // fromZ === toZ จะกลายเป็นวงกลมแบนปกติโดยอัตโนมัติ (ค่า Z ไม่เปลี่ยนตลอดวง)
    function helixTurn(cx, cy, startX, startY, fromZ, toZ, clockwise, f) {
      const iVal = cx - startX, jVal = cy - startY;
      const cmd = clockwise ? 'G2' : 'G3';
      emit(`${cmd} X${fmt(startX)} Y${fmt(startY)} Z${fmt(toZ)} I${fmt(iVal)} J${fmt(jVal)} F${fmt(f)}`);
      const r = Math.hypot(iVal, jVal);
      stats.cutMM += 2 * Math.PI * r;
      cur = { x: startX, y: startY, z: toZ };
    }
    function trackMove(x, y, z, isRapid) {
      const nx = x !== undefined ? x : cur.x;
      const ny = y !== undefined ? y : cur.y;
      const nz = z !== undefined ? z : cur.z;
      if (cur.x !== null) {
        const d = Math.hypot((nx ?? cur.x) - cur.x, (ny ?? cur.y) - cur.y, (nz ?? cur.z) - cur.z);
        if (isRapid) stats.rapidMM += d; else stats.cutMM += d;
      }
      cur = { x: nx, y: ny, z: nz };
    }

    emit('(Generated by DXF to G-Code Generator)');
    emit('(' + new Date().toISOString() + ')');
    if (header && header.trim()) header.split(/\r?\n/).forEach(l => emit(l));
    blank();

    const blocks = orderOperations(job.operations, machine);

    for (const block of blocks) {
      const tool = block.tool;
      if (lastTool !== block.toolNumber) {
        blank();
        emit(`(--- Tool ${block.toolNumber}: ${tool.name} | Ø${tool.diameter}mm ---)`);
        if (toolChange && toolChange.trim()) {
          fillTemplate(toolChange, block.toolNumber, tool.name).split(/\r?\n/).forEach(l => emit(l));
        }
        emit(`M3 S${Math.round(tool.spindle)}`);
        stats.toolChanges++;
        lastTool = block.toolNumber;
        blank();
      }
      emit(`(Layer: ${block.layerName})`);
      for (const op of block.ops) {
        if (op.kind === 'drill') emitDrill(op);
        else if (op.kind === 'pocket') emitPocket(op);
        else if (op.kind === 'doorprofile') emitDoorProfile(op);
        else if (op.kind === 'mark') emitMark(op);
        else emitContour(op);
      }
    }

    blank();
    if (footer && footer.trim()) footer.split(/\r?\n/).forEach(l => emit(l));
    else { emit('M5'); emit(`G0 Z${fmt(safeZ)}`); emit('M30'); }

    stats.lineCount = lines.length;
    const feedXY = parseFloat((job.operations[0] && job.operations[0].tool && job.operations[0].tool.feedXY) || 3000);
    stats.estMinutes = stats.cutMM / Math.max(1, feedXY) + stats.rapidMM / 8000;

    return { gcode: lines.join('\n'), stats };

    function emitContour(op) {
      const t = op.tool;
      emit(`(${op.cutType} | layer ${op.layer})`);

      if (op.circleMeta && (!op.tabs || !op.tabs.length)) {
        const { cx, cy, r } = op.circleMeta;
        const clockwise = signedAreaLocal(op.path) < 0;
        const startX = cx + r, startY = cy;
        rapid(undefined, undefined, safeZ);
        rapid(startX, startY, undefined);
        rapid(undefined, undefined, clearance);
        op.passes.forEach((zCut) => {
          // ดิ่งตรงลงด้วย feedZ แล้ววนรอบแบน — ไม่มี ramp
          feed(undefined, undefined, zCut, t.feedZ);
          const iCmd = clockwise ? 'G2' : 'G3';
          emit(`${iCmd} X${fmt(startX)} Y${fmt(startY)} Z${fmt(zCut)} I${fmt(cx - startX)} J${fmt(cy - startY)} F${fmt(t.feedXY)}`);
          stats.cutMM += 2 * Math.PI * r;
          cur = { x: startX, y: startY, z: zCut };
        });
        rapid(undefined, undefined, safeZ);
        blank();
        return;
      }

      // รูปทรงทั่วไป (closed/open, มี tab หรือไม่)
      const isProfileOutside = op.cutType === 'Profile Outside' && op.closed
        && (!op.tabs || !op.tabs.length) && !op.circleMeta;

      if (isProfileOutside) {
        emitProfileOutsideRamp(op);
        return;
      }

      const startPt = op.path[0];
      const lastIdx = op.passes.length - 1;
      const finalFeedOverride = (op.isSmallPart && machine.smallPartFinalFeed > 0)
        ? machine.smallPartFinalFeed : null;
      rapid(undefined, undefined, safeZ);
      rapid(startPt.x, startPt.y, undefined);
      rapid(undefined, undefined, clearance);

      if (!op.closed && (!op.tabs || !op.tabs.length)) {
        // Open path: boustrophedon — สลับทิศทุก pass ไม่กลับจุดเริ่ม
        // pass คู่ (0,2,4...): forward (path ปกติ)
        // pass คี่ (1,3,5...): reverse (path กลับหัว)
        let fwdPath = op.path.slice();
        let fwdArc = op.arcRanges;
        op.passes.forEach((zCut, idx) => {
          const isLast = (idx === lastIdx);
          const feedXY = (isLast && finalFeedOverride) ? finalFeedOverride : t.feedXY;
          const forward = (idx % 2 === 0);
          const curPath = forward ? fwdPath : fwdPath.slice().reverse();
          const curArc = forward ? fwdArc : (fwdArc ? reverseArcRanges(fwdArc, fwdPath.length) : null);
          // ดิ่งตรงลงที่ตำแหน่งปัจจุบัน (ต้นหรือปลาย path สลับกัน)
          feed(undefined, undefined, zCut, t.feedZ);
          emitFlatWithArcs(curPath, curArc, zCut, feedXY);
        });
      } else {
        // Closed path หรือมี tab: ดิ่งตรงลงทุก pass
        op.passes.forEach((zCut, idx) => {
          const isLast = (idx === lastIdx);
          const feedXY = (isLast && finalFeedOverride) ? finalFeedOverride : t.feedXY;
          if (idx > 0) feed(startPt.x, startPt.y, undefined, t.feedXY);
          feed(undefined, undefined, zCut, t.feedZ);
          if (op.tabs && op.tabs.length) {
            const pts = tabbedPath(op.path, op.tabs, zCut, op.tabTopZ);
            for (let i = 1; i < pts.length; i++) feed(pts[i].x, pts[i].y, pts[i].z, feedXY);
          } else {
            emitFlatWithArcs(op.path, op.arcRanges, zCut, feedXY);
          }
        });
      }
      rapid(undefined, undefined, safeZ);
      blank();
    }

    /* -----------------------------------------------------------------------
     * หา index ที่ดีที่สุดสำหรับเริ่ม ramp: vertex ที่ segment ถัดไปเป็นเส้นตรง
     * และยาวที่สุด (มีพื้นที่ ramp มากสุด, ไม่เริ่มบน arc)
     * ----------------------------------------------------------------------- */
    function findBestRampStart(path, arcRanges) {
      const n = path.length - 1; // path ปิด: path[0] === path[n]
      let bestIdx = 0, bestLen = -1;
      for (let i = 0; i < n; i++) {
        // เช็คว่า segment จาก i → i+1 เป็นเส้นตรง (ไม่ใช่ arc)
        const onArc = arcRanges && arcRanges.some(r => i >= r.startIdx && i < r.endIdx);
        if (onArc) continue;
        const a = path[i], b = path[i + 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len > bestLen) { bestLen = len; bestIdx = i; }
      }
      return bestIdx;
    }

    /* -----------------------------------------------------------------------
     * Rotate closed path ให้เริ่มที่ startIdx (path[0]=path[n] ยังคงปิดวง)
     * arcRanges offset index ตามไปด้วย
     * ----------------------------------------------------------------------- */
    function rotatePathFrom(path, arcRanges, startIdx) {
      const n = path.length - 1;
      if (startIdx === 0) return { path, arcRanges };
      const body = path.slice(0, n); // ตัดจุดปิดซ้ำออก
      const rotated = body.slice(startIdx).concat(body.slice(0, startIdx));
      rotated.push({ x: rotated[0].x, y: rotated[0].y }); // ปิดวงอีกครั้ง
      let newArc = null;
      if (arcRanges && arcRanges.length) {
        newArc = arcRanges.map(r => ({
          ...r,
          startIdx: ((r.startIdx - startIdx + n) % n),
          endIdx:   ((r.endIdx   - startIdx + n) % n)
        }));
      }
      return { path: rotated, arcRanges: newArc };
    }

    /* -----------------------------------------------------------------------
     * Profile Outside พร้อม bidirectional ramp 45° ต่อ pass (ไม่ยก Z ระหว่าง pass)
     *
     * ต่อ pass (fromZ → toZ):
     *   leg = |toZ - fromZ| / 2        ← ระยะ XY ต่อขา (45° = ΔZ/2 ต่อขา)
     *   G1 [S + leg ไปตาม segment] Z[fromZ+ΔZ/2]   ← ขาไป
     *   G1 [S]                     Z[toZ]            ← ขากลับ (ถึง Z เต็ม)
     *   emitFlatWithArcs (วนรอบเต็ม Z=toZ)          ← ตัดครบรอบ
     *   (pass ถัดไปไม่ยก Z — เริ่มต่อจากจุดสุดท้ายของรอบ = S)
     * ----------------------------------------------------------------------- */
    function emitProfileOutsideRamp(op) {
      const t = op.tool;
      emit(`(${op.cutType} | layer ${op.layer})`);

      // หาจุดเริ่ม + rotate path
      const startIdx = findBestRampStart(op.path, op.arcRanges);
      const { path: rPath, arcRanges: rArc } = rotatePathFrom(op.path, op.arcRanges, startIdx);
      const S = rPath[0];
      const finalFeedOverride = (op.isSmallPart && machine.smallPartFinalFeed > 0)
        ? machine.smallPartFinalFeed : null;

      rapid(undefined, undefined, safeZ);
      rapid(S.x, S.y, undefined);
      rapid(undefined, undefined, clearance);

      let fromZ = clearance;
      op.passes.forEach((zCut, idx) => {
        const isLast = (idx === op.passes.length - 1);
        const feedXY = (isLast && finalFeedOverride) ? finalFeedOverride : t.feedXY;
        const deltaZ = Math.abs(zCut - fromZ);
        const leg = deltaZ / 2; // ระยะต่อขา (45° bidir)

        // หาจุด R ที่อยู่ห่าง S ไป leg mm ตาม segment เส้นตรงแรก
        // สะสม segment จาก S เรื่อยๆ จนครบ leg mm
        let acc = 0, Rx = S.x, Ry = S.y;
        for (let i = 1; i < rPath.length && acc < leg - 1e-6; i++) {
          const onArc = rArc && rArc.some(r => (i - 1) >= r.startIdx && (i - 1) < r.endIdx);
          if (onArc) break; // หยุดที่ขอบ arc ไม่ ramp บน arc
          const a = rPath[i - 1], b = rPath[i];
          const segLen = Math.hypot(b.x - a.x, b.y - a.y);
          if (acc + segLen >= leg) {
            const tt = (leg - acc) / segLen;
            Rx = a.x + tt * (b.x - a.x);
            Ry = a.y + tt * (b.y - a.y);
            acc = leg;
          } else {
            Rx = b.x; Ry = b.y; acc += segLen;
          }
        }

        const zMid = fromZ - deltaZ / 2; // Z หลังขาไป
        // ขาไป: S → R พร้อม ramp ลง fromZ → zMid
        feed(Rx, Ry, zMid, feedXY);
        // ขากลับ: R → S พร้อม ramp ลงต่อ zMid → zCut
        feed(S.x, S.y, zCut, feedXY);
        // วนรอบเต็มที่ zCut (pass ถัดไปเริ่มต่อจากจุดนี้โดยไม่ยก Z)
        emitFlatWithArcs(rPath, rArc, zCut, feedXY);
        fromZ = zCut;
      });

      rapid(undefined, undefined, safeZ);
      blank();
    }

    // เส้นเปิด: ย้อนกลับจุดเริ่มโดยเดินตามแนวเส้นในทางกลับ (อยู่ในร่องเดิม ไม่ตัดทแยง)
    // ตอนเรียก มีดอยู่ที่ปลายเส้น (E) ที่ระดับ z
    function emitReverseRetrace(path, z, feedXY) {
      for (let i = path.length - 2; i >= 0; i--) feed(path[i].x, path[i].y, z, feedXY);
    }

    // เส้นปิด: เก็บลิ่มที่ ramp ทิ้งไว้ — ตอนเรียก มีดอยู่ที่จุดเริ่ม (S) ที่ระดับเต็ม (toZ) แล้ว
    // ตัดต่อจาก S ไปตามเส้นจนถึงจุดที่ ramp ถึงระดับเต็ม (R = ระยะตามเส้น = effRamp) ที่ระดับ toZ
    function emitRampCloseOff(path, fromZ, toZ, feedXY) {
      const rampDist = Math.abs(toZ - fromZ);
      if (rampDist < 1e-6 || path.length < 2) return;
      const total = pathLength(path);
      const effRamp = Math.min(rampDist, Math.max(total, 1e-6));
      let acc = 0;
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i];
        const segLen = Math.hypot(b.x - a.x, b.y - a.y);
        if (acc + segLen >= effRamp - 1e-9) {
          const tt = (effRamp - acc) / (segLen || 1);
          feed(a.x + tt * (b.x - a.x), a.y + tt * (b.y - a.y), toZ, feedXY);
          return;
        }
        feed(b.x, b.y, toZ, feedXY);
        acc += segLen;
      }
    }

    // เส้นเปิด pass สุดท้าย: ramp S→R (ลง toZ ภายในระยะ effRamp) → ย้อน R→S ที่ toZ →
    // เดินหน้าเต็มเส้น S→E ที่ toZ — ตอนเรียก มีดอยู่ที่ S ที่ระดับ fromZ
    function emitOpenLastPass(path, fromZ, toZ, feedXY) {
      if (path.length < 2) return;
      const total = pathLength(path);
      const rampDist = Math.abs(toZ - fromZ);
      const effRamp = Math.min(Math.max(rampDist, 1e-6), Math.max(total, 1e-6));
      // 1) ramp S→R พร้อมเก็บจุดที่เดินผ่าน (รวม R) ไว้ย้อนกลับ
      const fwd = [];
      let acc = 0, reached = false;
      for (let i = 1; i < path.length && !reached; i++) {
        const a = path[i - 1], b = path[i];
        const segLen = Math.hypot(b.x - a.x, b.y - a.y);
        if (acc + segLen >= effRamp - 1e-9) {
          const tt = (effRamp - acc) / (segLen || 1);
          const rx = a.x + tt * (b.x - a.x), ry = a.y + tt * (b.y - a.y);
          feed(rx, ry, toZ, feedXY);
          fwd.push({ x: rx, y: ry });
          reached = true;
        } else {
          const z = fromZ + (toZ - fromZ) * ((acc + segLen) / effRamp);
          feed(b.x, b.y, z, feedXY);
          fwd.push({ x: b.x, y: b.y });
          acc += segLen;
        }
      }
      // 2) ย้อน R→S ที่ระดับ toZ (ผ่านจุดเดิมในทางกลับ แล้วจบที่ S)
      for (let i = fwd.length - 2; i >= 0; i--) feed(fwd[i].x, fwd[i].y, toZ, feedXY);
      feed(path[0].x, path[0].y, toZ, feedXY);
      // 3) เดินหน้าเต็มเส้น S→E ที่ระดับ toZ
      for (let i = 1; i < path.length; i++) feed(path[i].x, path[i].y, toZ, feedXY);
    }

    /* -----------------------------------------------------------------------
     * Bidirectional Ramp สำหรับ closed path:
     *   1) วิ่งจากจุดเริ่ม (S) ไปถึงจุดกึ่งกลาง path (M) พร้อม ramp Z จาก fromZ → toZ
     *      ช่วง ramp กระจายตลอดครึ่งแรก (0→M) ไม่ใช่แค่ระยะ |ΔZ| เดิม
     *   2) reverse กลับจาก M → S ที่ Z = toZ (ปิดจุด "ลิ่ม" จากครึ่งแรก)
     *   3) วิ่งรอบเต็ม S → E = S ที่ Z = toZ (ตัดครบรอบ ผิวงานเรียบ)
     *
     * ข้อดี: ไม่มีลิ่มเหลือเลย ไม่ต้องเรียก emitRampCloseOff
     * ข้อพิจารณา: ครึ่งหลังของขั้นตอน 1 (reverse M→S) วิ่ง Conventional แต่เป็นแค่
     *   ramp pass ที่แรงตัดน้อย ในทางปฏิบัติยอมรับได้
     * Arc: ถ้า arcRanges มี arc อยู่หลัง midpoint จะออก G2/G3 ได้ปกติ (arc อยู่ใน
     *   ขั้นตอน 3 ที่ Z คงที่) ส่วน arc ที่อยู่ในครึ่งแรก/reverse ใช้ linear approximation
     *   (tessellated points) เหมือน ramp ปกติ — ยอมรับได้เพราะ ramp สั้น
     * --------------------------------------------------------------------- */
    function emitBidirRamp(path, arcRanges, fromZ, toZ, feedXY) {
      if (!path || path.length < 2) return;
      const total = pathLength(path);
      if (total < 1e-6) return;

      // หาจุดกึ่งกลาง path (M) ตาม arc length สะสม
      const halfLen = total / 2;
      let acc = 0;
      let midPt = null;
      let midIdx = 0; // index ของ segment ที่ผ่านจุดกลาง
      const fwdPts = [{ x: path[0].x, y: path[0].y }]; // จุดที่วิ่งผ่านในครึ่งแรก (รวม M)
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i];
        const segLen = Math.hypot(b.x - a.x, b.y - a.y);
        if (acc + segLen >= halfLen - 1e-9 && !midPt) {
          const tt = (halfLen - acc) / (segLen || 1);
          midPt = { x: a.x + tt * (b.x - a.x), y: a.y + tt * (b.y - a.y) };
          fwdPts.push(midPt);
          midIdx = i;
          // ถ้า segment ยังเหลืออีก (M ไม่ตรงกับปลาย segment) ไม่เพิ่มจุดหลัง M ในครึ่งแรก
        }
        acc += segLen;
      }
      if (!midPt) midPt = path[Math.floor(path.length / 2)];

      // ขั้นตอน 1: วิ่ง S → M พร้อม ramp Z จาก fromZ → toZ (กระจายตลอดครึ่งแรก)
      acc = 0;
      let reached = false;
      for (let i = 1; i < path.length && !reached; i++) {
        const a = path[i - 1], b = path[i];
        const segLen = Math.hypot(b.x - a.x, b.y - a.y);
        const accBefore = acc, accAfter = acc + segLen;
        if (accAfter >= halfLen - 1e-9) {
          // segment นี้ผ่านจุดกลาง — วิ่งถึง M แล้วหยุด
          const tt = (halfLen - accBefore) / (segLen || 1);
          const z = fromZ + (toZ - fromZ) * (accAfter <= halfLen ? accAfter / halfLen : 1);
          feed(midPt.x, midPt.y, toZ, feedXY);
          reached = true;
        } else {
          // ramp Z ตามสัดส่วน arc length
          const z = fromZ + (toZ - fromZ) * (accAfter / halfLen);
          feed(b.x, b.y, z, feedXY);
        }
        acc = accAfter;
      }

      // ขั้นตอน 2: reverse M → S ที่ Z = toZ (ปิดลิ่ม)
      for (let i = fwdPts.length - 2; i >= 0; i--) {
        feed(fwdPts[i].x, fwdPts[i].y, toZ, feedXY);
      }

      // ขั้นตอน 3: วิ่งรอบเต็ม S → E (= S) ที่ Z = toZ พร้อม arc G2/G3 ถ้ามี
      emitFlatWithArcs(path, arcRanges, toZ, feedXY);
    }

    // เดินตามเส้นตรง + arc (G2/G3) ทั้งหมดที่ Z คงที่ — ไม่มี ramp
    function emitFlatWithArcs(path, arcRanges, z, feedXY) {
      for (let i = 1; i < path.length; i++) {
        const ar = arcRanges && arcRanges.find(r => r.startIdx === i - 1);
        if (ar) {
          const startPt2 = path[ar.startIdx], endPt2 = path[ar.endIdx];
          const cmd = ar.ccw ? 'G3' : 'G2';
          emit(`${cmd} X${fmt(endPt2.x)} Y${fmt(endPt2.y)} Z${fmt(z)} I${fmt(ar.cx - startPt2.x)} J${fmt(ar.cy - startPt2.y)} F${fmt(feedXY)}`);
          stats.cutMM += 2 * Math.PI * ar.r;
          cur = { x: endPt2.x, y: endPt2.y, z };
          i = ar.endIdx;
          continue;
        }
        feed(path[i].x, path[i].y, z, feedXY);
      }
    }

    // เดินตาม path + arc ที่มีอยู่ใน gcode — wrapper ชื่อเดิมสำหรับ backward compat
    function emitRampedPathWithArcs(path, arcRanges, fromZ, toZ, feedXY) {
      const rampDist = Math.abs(toZ - fromZ);
      if (rampDist < 1e-6) {
        // ไม่มีการเปลี่ยนความลึกรอบนี้ (กรณีพิเศษ) — เดินที่ Z เดิมตลอด ใช้โค้งได้เต็มที่
        return emitFlatWithArcs(path, arcRanges, toZ, feedXY);
      }
      const total = pathLength(path);
      const effRamp = Math.min(rampDist, Math.max(total, 1e-6));
      let acc = 0, idx = 1;
      while (idx < path.length) {
        const ar = arcRanges && arcRanges.find(r => r.startIdx === idx - 1);
        if (ar && acc >= effRamp - 1e-6) {
          const startPt2 = path[ar.startIdx], endPt2 = path[ar.endIdx];
          const cmd = ar.ccw ? 'G3' : 'G2';
          emit(`${cmd} X${fmt(endPt2.x)} Y${fmt(endPt2.y)} Z${fmt(toZ)} I${fmt(ar.cx - startPt2.x)} J${fmt(ar.cy - startPt2.y)} F${fmt(feedXY)}`);
          stats.cutMM += 2 * Math.PI * ar.r; // ประมาณระยะ (สถิติเท่านั้น ไม่กระทบความถูกต้องของ G-code)
          cur = { x: endPt2.x, y: endPt2.y, z: toZ };
          idx = ar.endIdx + 1;
          continue;
        }
        const a = path[idx - 1], b = path[idx];
        const segLen = Math.hypot(b.x - a.x, b.y - a.y);
        const accBefore = acc, accAfter = acc + segLen;
        if (accAfter <= effRamp) {
          // ทั้งช่วงนี้ยังอยู่ในโซน ramp
          const z = fromZ + (toZ - fromZ) * (accAfter / effRamp);
          feed(b.x, b.y, z, feedXY);
        } else if (accBefore >= effRamp) {
          // เลยโซน ramp ไปแล้ว อยู่ที่ความลึกเป้าหมายเต็มที่
          feed(b.x, b.y, toZ, feedXY);
        } else {
          // ช่วงนี้คาบเกี่ยว: ส่วนแรกยัง ramp ส่วนหลังถึงความลึกแล้ว -> แทรกจุดกึ่งกลางที่ความลึกพอดี
          const tt = (effRamp - accBefore) / segLen;
          const mx = a.x + tt * (b.x - a.x), my = a.y + tt * (b.y - a.y);
          feed(mx, my, toZ, feedXY);
          feed(b.x, b.y, toZ, feedXY);
        }
        acc = accAfter;
        idx++;
      }
    }

    // ใช้เมื่อไม่มีการเปลี่ยน Z เลย (rampDist=0) — เดินที่ความลึกเดิม ใช้ G2/G3 ได้ทุกมุมโค้ง
    function emitFlatWithArcs(path, arcRanges, z, feedXY) {
      let idx = 1;
      while (idx < path.length) {
        const ar = arcRanges && arcRanges.find(r => r.startIdx === idx - 1);
        if (ar) {
          const startPt2 = path[ar.startIdx], endPt2 = path[ar.endIdx];
          const cmd = ar.ccw ? 'G3' : 'G2';
          emit(`${cmd} X${fmt(endPt2.x)} Y${fmt(endPt2.y)} Z${fmt(z)} I${fmt(ar.cx - startPt2.x)} J${fmt(ar.cy - startPt2.y)} F${fmt(feedXY)}`);
          stats.cutMM += 2 * Math.PI * ar.r;
          cur = { x: endPt2.x, y: endPt2.y, z };
          idx = ar.endIdx + 1;
          continue;
        }
        feed(path[idx].x, path[idx].y, z, feedXY);
        idx++;
      }
    }

    /* =========================================================================
     * โหมด "ตีบัวหน้าบาน" — ใช้ G2/G3 สำหรับมุมโค้งเหมือน Profile ทั่วไป แต่ที่มุม
     * แหลมจริงของ pass สุดท้าย (op.spikeIndices) จะแทรกการแทง-ถอน: ขึ้นไปแตะมุมจริง
     * บนเส้น V-line ที่ผิวไม้ (op.surfacePath ที่ Z=op.surfaceZ) แล้วถอนกลับลงมาที่
     * ความลึกตัดเดิม ก่อนเดินทางต่อ — เก็บมุมที่ดอก V-bit ทรงกรวยกัดมุมแหลมไม่ถึง
     * ========================================================================= */
    function emitFlatWithArcsAndSpikes(path, arcRanges, z, feedXY, spikeSet, surfacePath, surfaceZ) {
      const n = path.length - 1;
      let idx = 1;
      while (idx < path.length) {
        const ar = arcRanges && arcRanges.find(r => r.startIdx === idx - 1);
        if (ar) {
          const startPt2 = path[ar.startIdx], endPt2 = path[ar.endIdx];
          const cmd = ar.ccw ? 'G3' : 'G2';
          emit(`${cmd} X${fmt(endPt2.x)} Y${fmt(endPt2.y)} Z${fmt(z)} I${fmt(ar.cx - startPt2.x)} J${fmt(ar.cy - startPt2.y)} F${fmt(feedXY)}`);
          stats.cutMM += 2 * Math.PI * ar.r;
          cur = { x: endPt2.x, y: endPt2.y, z };
          idx = ar.endIdx + 1;
          continue;
        }
        feed(path[idx].x, path[idx].y, z, feedXY);
        const logicalIdx = idx % n;
        if (spikeSet.has(logicalIdx)) {
          const sp = surfacePath[logicalIdx];
          feed(sp.x, sp.y, surfaceZ, feedXY);            // แทง: ขึ้นไปแตะมุมจริงที่ผิวไม้
          feed(path[idx].x, path[idx].y, z, feedXY);      // ถอน: กลับลงที่ความลึกตัดเดิม
        }
        idx++;
      }
    }

    function emitDoorProfile(op) {
      const t = op.tool;
      emit(`(ตีบัวหน้าบาน | ${op.layer})`);
      const startPt = op.path[0];
      const lastIdx = op.passes.length - 1;
      const spikeSet = op.spikeIndices ? new Set(op.spikeIndices) : null;
      rapid(undefined, undefined, safeZ);
      rapid(startPt.x, startPt.y, undefined);
      rapid(undefined, undefined, clearance);
      op.passes.forEach((zCut, idx) => {
        if (idx > 0) feed(startPt.x, startPt.y, undefined, t.feedXY); // กลับจุดเริ่มที่ความสูงเดิม (ไม่ยก)
        feed(undefined, undefined, zCut, t.feedZ); // ดิ่งลงตรงไปความลึกของ pass นี้
        const isLast = (idx === lastIdx);
        if (isLast && spikeSet && spikeSet.size) {
          emitFlatWithArcsAndSpikes(op.path, op.arcRanges, zCut, t.feedXY, spikeSet, op.surfacePath, op.surfaceZ);
        } else {
          emitFlatWithArcs(op.path, op.arcRanges, zCut, t.feedXY);
        }
      });
      rapid(undefined, undefined, safeZ);
      blank();
    }

    /* -----------------------------------------------------------------------
     * emitMark: Mark Square (เส้นเปิด L-shape ที่ offset แล้วจาก toolpath-generator)
     * เดิน path เปิด ลงทุก pass แบบ reverse-retrace เหมือน Profile On Line open
     * ไม่มี tab / arc / ramp พิเศษ (เส้นตรงสั้น 2 segment เท่านั้น)
     * --------------------------------------------------------------------- */
    function emitMark(op) {
      const t = op.tool;
      emit(`(Mark Square | layer ${op.layer})`);
      if (!op.path || op.path.length < 2) return;
      const startPt = op.path[0];
      const lastIdx = op.passes.length - 1;
      rapid(undefined, undefined, safeZ);
      rapid(startPt.x, startPt.y, undefined);
      rapid(undefined, undefined, clearance);
      let fromZ = clearance;
      op.passes.forEach((zCut, idx) => {
        const isLast = idx === lastIdx;
        // final pass feed override สำหรับ mark (ใช้ค่าเดียวกับ smallPartFinalFeed ถ้าตั้งไว้)
        const finalFeedVal = (isLast && machine.smallPartFinalFeed > 0) ? machine.smallPartFinalFeed : t.feedXY;
        if (idx > 0) {
          // ย้อนกลับจุดเริ่มตามแนวเส้น (อยู่ในร่อง ไม่ตัดทแยง)
          for (let i = op.path.length - 2; i >= 0; i--) feed(op.path[i].x, op.path[i].y, fromZ, t.feedXY);
        }
        // ดิ่งตรง feedZ แล้วเดินเส้น — ไม่มี ramp
        feed(undefined, undefined, zCut, t.feedZ);
        for (let i = 1; i < op.path.length; i++) feed(op.path[i].x, op.path[i].y, zCut, finalFeedVal);
      });
      rapid(undefined, undefined, safeZ);
      blank();
    }

    function emitPocket(op) {
      const t = op.tool;
      emit(`(Pocket | layer ${op.layer})`);

      if (op.circleRings && op.circleRings.length) {
        // Pocket วงกลม: ทุก pass ลงแบบ helix บนวงในสุดก่อน (ที่ตำแหน่งนั้นเปลี่ยนความลึก)
        // ส่วนวงอื่นในพาสเดียวกัน Z ไม่เปลี่ยน (helix แบบ fromZ=toZ = วงกลมแบนปกติ)
        const rings = op.circleRings; // index0=วงนอกสุด, ลำดับสุดท้าย=วงในสุด
        const clockwise = (machine.cutDirection === 'climb');
        const innermost = rings[rings.length - 1];
        rapid(undefined, undefined, safeZ);
        rapid(innermost.cx + innermost.r, innermost.cy, undefined);
        rapid(undefined, undefined, clearance);
        let fromZ = clearance;
        for (const zCut of op.passes) {
          for (let r = rings.length - 1; r >= 0; r--) {
            const ring = rings[r];
            const sx = ring.cx + ring.r, sy = ring.cy;
            feed(sx, sy, undefined, t.feedXY); // ย้ายไปจุดเริ่มวงนี้ที่ความสูงเดิม (ไม่ยกมีด)
            const z0 = (r === rings.length - 1) ? fromZ : zCut; // วงแรกของ pass นี้ลง ramp/helix, วงอื่นแบนอยู่แล้ว
            helixTurn(ring.cx, ring.cy, sx, sy, z0, zCut, clockwise, t.feedXY);
          }
          fromZ = zCut;
        }
        // เก็บรอย seam ของวงในสุด (วงเดียวที่ลงแบบ helix ในแต่ละ pass) ด้วยวงแบนที่ Z สุดท้าย
        if (op.passes.length) {
          const zLast = op.passes[op.passes.length - 1];
          const sx = innermost.cx + innermost.r, sy = innermost.cy;
          feed(sx, sy, undefined, t.feedXY);
          helixTurn(innermost.cx, innermost.cy, sx, sy, zLast, zLast, clockwise, t.feedXY);
        }
        rapid(undefined, undefined, safeZ);
        blank();
        return;
      }

      const startRing = op.rings[op.rings.length - 1];
      rapid(undefined, undefined, safeZ);
      rapid(startRing[0].x, startRing[0].y, undefined);
      rapid(undefined, undefined, clearance);
      let pocketFirstPass = true;
      for (const zCut of op.passes) {
        // วนจาก ring ในสุด → นอกสุด ดิ่งตรง feedZ ที่จุดเริ่มของ pass แล้ววนรอบแบน
        // ไม่มี ramp ไม่มีวงเก็บลิ่ม ไม่ยก Z ระหว่าง ring และระหว่าง pass
        let firstRingInPass = true;
        for (let r = op.rings.length - 1; r >= 0; r--) {
          const ring = op.rings[r];
          if (!ring || ring.length < 2) continue;
          if (firstRingInPass && pocketFirstPass) {
            // pass แรก ring แรก: อยู่ที่ clearance แล้ว ดิ่งตรงลงได้เลย
            feed(undefined, undefined, zCut, t.feedZ);
            firstRingInPass = false;
          } else if (firstRingInPass) {
            // pass ถัดไป ring แรก: feed กลับจุดเริ่มแล้วดิ่งตรงลง
            feed(ring[0].x, ring[0].y, undefined, t.feedXY);
            feed(undefined, undefined, zCut, t.feedZ);
            firstRingInPass = false;
          } else {
            // ring ถัดไปใน pass เดียวกัน: feed ไปจุดเริ่ม ring (Z ยังคงที่)
            feed(ring[0].x, ring[0].y, undefined, t.feedXY);
          }
          // วนรอบ ring แบน (Z คงที่)
          for (let i = 1; i < ring.length; i++) feed(ring[i].x, ring[i].y, zCut, t.feedXY);
        }
        pocketFirstPass = false;
      }
      rapid(undefined, undefined, safeZ);
      blank();
    }

    function emitDrill(op) {
      const t = op.tool;
      emit(`(Drill | layer ${op.layer} @ X${fmt(op.point.x)} Y${fmt(op.point.y)})`);
      rapid(undefined, undefined, safeZ);
      rapid(op.point.x, op.point.y, undefined);
      rapid(undefined, undefined, clearance);
      // ถอยขึ้นก่อนเจาะ pass ถัดไป: ไม่ว่า z0Mode จะเป็น 'top' (ค่าความลึกติดลบ) หรือ
      // 'table' (ค่าเป็นบวกแต่ลดลงเมื่อลึกขึ้น) "ถอยขึ้น" คือ Z เพิ่มขึ้นเสมอทั้งสองโหมด
      // (ผิวไม้/clearance อยู่สูงกว่าจุดเจาะเสมอ) ไม่ต้องเช็คเครื่องหมายของ targetZ เลย
      for (let i = 0; i < op.passes.length; i++) {
        const zCut = op.passes[i];
        feed(undefined, undefined, zCut, t.feedZ);
        if (i < op.passes.length - 1) rapid(undefined, undefined, zCut + 1);
      }
      rapid(undefined, undefined, safeZ);
      blank();
    }
  }

  global.GCodeGenerator = { generate, fmt, fillTemplate, orderOperations, rampedPath, pathLength };

})(typeof window !== 'undefined' ? window : globalThis);
