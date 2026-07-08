/* =============================================================================
 * machine-config.js (v2)
 * -----------------------------------------------------------------------------
 * สถานะกลางของแอป + ค่าตั้งต้น
 *   - Machine Setup: units, safeZ, rapidClearance, pocketStepover,
 *     woodThickness, originCorner (มุมอ้างอิง X0Y0 จาก _ABF_SHEET_BORDER),
 *     z0Mode ('top' ผิวไม้ / 'table' พื้นโต๊ะตัด), cutDeeper
 *   - Tool Library: เพิ่ม isOutsideTool (ทูลหลักสำหรับตัดนอก)
 *   - Layer Mapping: จดจำถาวรผูกกับชื่อ Layer ข้ามไฟล์ (เก็บใน savedMappings)
 *   - ลำดับการตัด (cutOrder): ลำดับกลุ่มมีดสำหรับเฟส 1 (Pocket/Drill/Engrave)
 * ========================================================================== */

(function (global) {
  'use strict';

  const OPERATIONS = [
    'None',
    'Profile Outside',
    'Profile Inside',
    'Profile On Line',
    'Pocket',
    'Drill',
    'Engrave',
    'Mark Square',   // เส้นเปิด L-shape สำหรับงาน Bottom: offset ออกด้านนอกตามทิศของมุมที่อยู่
    'Drill Corners', // เจาะทุก vertex จริงของเส้น (ทั้งปิดและเปิด ยกเว้นวงกลม/arc ล้วน)
    'Drill Endpoints' // เจาะจุดปลาย 2 จุดของเส้นเปิดเท่านั้น (head + tail)
  ];

  // เลเยอร์อ้างอิงจาก ABF/SketchUp ที่ไม่ใช่งานตัด — ไม่แสดงในหน้า Layer และไม่นำไปสร้าง toolpath
  // _ABF_SHEET_BORDER ยังใช้เป็นกรอบอ้างอิงจุด (0,0) ได้ (และตอนนี้แสดงในพรีวิวด้วย)
  // แต่ _ABF_SHEET_ID / _ABF_SHEET_MATERIAL เป็นแค่ข้อความกำกับ ไม่เกี่ยวกับการตัดเลย
  const EXCLUDED_LAYERS = ['_ABF_SHEET_BORDER', '_ABF_SHEET_ID', '_ABF_SHEET_MATERIAL'];
  // เลเยอร์ที่ล็อกลำดับให้อยู่ท้ายสุดเสมอ (แก้ไขลำดับไม่ได้)
  const LOCKED_LAST_LAYER = '_ABF_CUTTING_LINES';

  function defaultMachine() {
    return {
      units: 'mm',
      safeZ: 25,
      rapidClearance: 2,
      pocketStepover: 80,
      woodThickness: 18,
      originCorner: 'bottom-left',
      z0Mode: 'top',
      cutDeeper: 0.3,
      cutDirection: 'climb',
      tabWidth: 6,
      tabHeight: 4,
      tabCount: 4,
      smallPartThreshold: 100,
      smallPartFinalPass: 2,
      smallPartFinalFeed: 5000
    };
  }

  function makeTool(number, over) {
    return Object.assign({
      number: number,
      name: number + ' Tool',
      diameter: 6,             // เส้นผ่านศูนย์กลางก้านมีด — ใช้ร่วมกันทั้ง Endmill/V-bit/Formtool
      spindle: 18000,
      feedXY: 4000,
      feedZ: 1000,
      passDepth: 5,
      safeHeight: 25,
      isOutsideTool: false,  // ทูลหลักสำหรับตัดนอก (ใช้เป็น default tool ของ mapping ที่เลือก Profile Outside)
      toolType: 'endmill',   // ชนิดทูล: 'endmill' | 'vbit' | 'formtool' — ตอนนี้เป็นแค่ข้อมูลกำกับ
                             // ยังไม่ผูกกับการคำนวณ G-code/offset ใด ๆ (รอเฟสถัดไป)
      vbitAngle: 90,         // องศาดอก — ใช้เฉพาะ toolType==='vbit'
      vbitTipDiameter: 0     // ขนาดปลายดอก (mm) — ใช้เฉพาะ toolType==='vbit', แก้ไขได้ (0 = ปลายแหลม)
    }, over || {});
  }

  function defaultTools() {
    return {
      1: makeTool(1, { name: '6mm Endmill', diameter: 6, spindle: 18000, feedXY: 5000, feedZ: 1500, passDepth: 10, safeHeight: 25, isOutsideTool: true })
    };
  }

  const defaultToolChange =
`M6 T{tool}`;

  function defaultHeader(units) {
    return 'G90';
  }
  const defaultFooter =
`M5 M09
M30`;

  // หา "ทูลหลักสำหรับตัดนอก" ตัวแรกที่ตั้งไว้ ถ้าไม่มีให้ใช้ทูลแรกสุด
  function findOutsideTool(tools) {
    const keys = Object.keys(tools).map(Number).sort((a, b) => a - b);
    const found = keys.find(n => tools[n].isOutsideTool);
    return found || keys[0] || 1;
  }

  // หาทูลตัวแรกที่ตั้ง toolType ตรงกับที่ต้องการ (เช่น 'vbit', 'formtool') ใช้เป็นค่าเริ่มต้น
  // ของโหมดตีบัวหน้าบาน — ถ้าไม่เจอคืน null (ให้ผู้ใช้เลือกเอง)
  function findToolByType(tools, type) {
    const keys = Object.keys(tools).map(Number).sort((a, b) => a - b);
    const found = keys.find(n => (tools[n].toolType || 'endmill') === type);
    return found || null;
  }

  // ค่าตั้งต้นของโหมด "ตีบัวหน้าบาน" — เก็บแยกต่อแท็บไฟล์ (ไม่ใช้ร่วมกันข้ามไฟล์)
  function defaultDoorMode(tools) {
    return {
      enabled: false,
      offset: 10,          // ระยะ V-line จากขอบหน้าบาน (mm)
      depth: 5,            // ความลึกตัด ใช้ร่วมกันทั้ง V-bit และ FormTool (mm)
      vbitTool: findToolByType(tools, 'vbit'),
      formtoolTool: findToolByType(tools, 'formtool'),
      vlineTool: null,     // มีดเดินตามเส้น V-line เพิ่มมิติให้งาน (ไม่บังคับเลือก)
      vlineDepth: 1,       // ความลึกของรอยตาม V-line — ตัวเลขตรง ๆ ไม่มีนิพจน์ (mm)
      borderTool: null,    // มีดตัดขอบออกจากแผ่นจริง (ไม่บังคับเลือก, ทำทีหลังสุดเสมอ)
      borderDepth: 'pt+cd' // ความลึกตัดขอบ — เป็นนิพจน์ได้ (pt=ความหนาไม้, cd=Cut Deeper)
    };
  }

  /* ---------------------------------------------------------------------------
   * สร้าง mapping เริ่มต้นสำหรับชื่อ layer ที่ "ไม่เคยเจอมาก่อน"
   * ถ้าเคยบันทึกไว้แล้ว (savedMappings) ให้ใช้ของเดิมเสมอ — ฟังก์ชันนี้จะถูกเรียก
   * เฉพาะกรณีที่ไม่มีค่าบันทึกไว้ (ดู resolveMapping ใน app.js)
   * ------------------------------------------------------------------------- */
  function guessMapping(layerName, tools, machine) {
    const up = layerName.toUpperCase();

    // cut_outside_ และ _ABF_CUTTING_LINES: คงเป็น Profile Outside/pt+cd เสมอ
    const isOutsideLayer = /^cut_outside_/i.test(layerName) || layerName === '_ABF_CUTTING_LINES';
    if (isOutsideLayer) {
      return {
        operation: 'Profile Outside',
        toolNumber: findOutsideTool(tools),
        depth: 'pt+cd',
        enabled: true,
        tabsEnabled: false,
        order: null
      };
    }

    // mark_square: ตรวจก่อนเงื่อนไขอื่น
    if (up.startsWith('MARK_SQUARE')) {
      return {
        operation: 'Mark Square',
        toolNumber: findOutsideTool(tools),
        depth: 'pt+cd',
        enabled: true,
        tabsEnabled: false,
        order: null
      };
    }

    // ทุก layer อื่น: default = None, depth = 0 (ให้ผู้ใช้ตั้งค่าเอง)
    const keys = Object.keys(tools).map(Number).sort((a, b) => a - b);
    const toolNumber = keys[0] || 1;
    return {
      operation: 'None',
      toolNumber,
      depth: 0,
      enabled: true,
      tabsEnabled: false,
      order: null
    };
  }

  function defaultState() {
    return {
      machine: defaultMachine(),
      tools: defaultTools(),
      savedMappings: {},   // { [layerName]: {operation,toolNumber,depth,enabled,tabsEnabled,tabCount} } — จดจำถาวร
      toolChange: defaultToolChange,
      header: defaultHeader('mm'),
      footer: defaultFooter,
      version: 2
    };
  }

  global.MachineConfig = {
    OPERATIONS, EXCLUDED_LAYERS, LOCKED_LAST_LAYER,
    defaultMachine, defaultTools, makeTool, defaultState,
    defaultToolChange, defaultHeader, defaultFooter,
    guessMapping, findOutsideTool, findToolByType, defaultDoorMode
  };

})(typeof window !== 'undefined' ? window : globalThis);
