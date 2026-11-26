import { createDocument } from './src/editor/model/Document'
import { isTrack } from './src/editor/model/Document'
import { Editor } from './src/editor/core/Editor'
import { computeSegmentSpan, cutPolylineBySegmentSpan } from './src/editor/topology/Topology'

let failures = 0
function assert(cond: boolean, msg: string): void {
  if (cond) console.log('  OK  ' + msg)
  else {
    console.log('  FAIL ' + msg)
    failures++
  }
}

console.log('--- 1. Esc 取消草稿 / Enter 结束 ---')
{
  const ed = new Editor(createDocument('t'))
  ed.drawTrack.begin({ x: 0, y: 0 })
  ed.drawTrack.addPoint({ x: 100, y: 0 })
  assert(ed.drawTrack.isDrawing, '草稿进行中')
  ed.cancelCurrent() // Esc
  assert(!ed.drawTrack.isDrawing, 'Esc 后草稿被取消')
  assert(ed.document.elements.length === 0, 'Esc 后没有生成轨道')
  ed.drawTrack.begin({ x: 0, y: 0 })
  ed.drawTrack.addPoint({ x: 100, y: 0 })
  ed.drawTrack.finish() // Enter / 双击
  assert(ed.document.elements.length === 1, 'Enter 后生成 1 条轨道')
}

console.log('--- 2. 端点落在既有线路中间 → 道岔不拆线 ---')
{
  const ed = new Editor(createDocument('t2'))
  ed.commitTrack([{ x: 0, y: 0 }, { x: 200, y: 0 }]) // 主线 A
  assert(ed.document.elements.filter(isTrack).length === 1, '主线 A 只有一条轨道')
  ed.commitTrack([{ x: 100, y: 0 }, { x: 100, y: 100 }]) // 新轨道端点在 A 中点
  const tracks = ed.document.elements.filter(isTrack)
  assert(tracks.length === 2, 'A 未拆线 + 新轨道 = 2 条')
  const a = tracks.find((t) => t.points.length === 3)
  assert(!!a, 'A 在中点插入了顶点（3 个点）')
  const switches = ed.document.nodes.filter((n) => n.nodeType === 'switch')
  assert(switches.length === 1, '生成 1 个 switch 节点')
  assert(switches[0]!.vertexLinks.some((l) => l.trackId === a!.id), 'switch 节点 vertexLink 指向 A')
  assert(ed.getTopologyIssues().length === 0, '拓扑检查通过')
  ed.undo()
  assert(ed.document.elements.filter(isTrack).length === 1, '一次 undo 还原')
  assert(ed.getTopologyIssues().length === 0, 'undo 后拓扑检查通过')
}

console.log('--- 3. 橡皮擦：沿线路拖动覆盖整段 ---')
{
  const pts = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 150, y: 0 }, { x: 200, y: 0 }]
  const stroke = [{ x: 30, y: 1 }, { x: 60, y: -1 }, { x: 90, y: 1 }, { x: 120, y: -1 }, { x: 150, y: 1 }, { x: 180, y: -1 }]
  const span = computeSegmentSpan(pts, stroke, 8)
  assert(span !== null && span.from === 0 && span.to === 3, `沿线路拖动覆盖 0..3 段（实际 ${span?.from}..${span?.to}）`)
  const stroke2 = [{ x: 100, y: -10 }, { x: 100, y: 10 }]
  const span2 = computeSegmentSpan(pts, stroke2, 8)
  assert(span2 !== null && span2.from === span2.to, `垂直穿过只覆盖一段（实际 ${span2?.from}..${span2?.to}）`)
  const stroke3 = [{ x: 300, y: 300 }]
  assert(computeSegmentSpan(pts, stroke3, 8) === null, '远离线路不命中')
}

console.log('--- 4. 折点边界切割（先切断再删除中间） ---')
{
  const pts = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 150, y: 0 }, { x: 200, y: 0 }]
  const r = cutPolylineBySegmentSpan(pts, { from: 1, to: 2 })
  assert(r.a !== null && r.a.length === 2 && r.a[1]!.x === 50, 'A 段 = [0, 50]（保留边界折点 P1）')
  assert(r.b !== null && r.b.length === 2 && r.b[0]!.x === 150, 'B 段 = [150, 200]（保留边界折点 P3）')
  // 靠近端部擦除：不误删后段
  const r3 = cutPolylineBySegmentSpan(pts, { from: 0, to: 1 })
  assert(r3.a === null && r3.b !== null && r3.b.length === 3, '擦前两段：后段 [100,150,200] 保留')
  const r4 = cutPolylineBySegmentSpan(pts, { from: 3, to: 4 })
  assert(r4.b === null && r4.a !== null && r4.a.length === 4, '擦后两段：前段 [0,50,100,150] 保留')
  const r2 = cutPolylineBySegmentSpan(pts, { from: 0, to: 4 })
  assert(r2.a === null && r2.b === null, '整条擦除')
}

console.log('--- 5. 对齐 > 角度 > 网格 ---')
{
  const ed = new Editor(createDocument('t5'))
  ed.commitTrack([{ x: 0, y: 0 }, { x: 100, y: 0 }]) // 顶点 (100,0)
  ed.state.snapGrid = true
  const r = ed.getSnapPoint({ x: 101, y: 3 }, true, { x: 0, y: 0 })
  assert(Math.abs(r.point.x - 100) < 1e-6 && Math.abs(r.point.y - 0) < 1e-6, `对齐+角度+网格 → (100,0)（实际 ${r.point.x},${r.point.y}）`)
  const r2 = ed.getSnapPoint({ x: 101, y: 3 }, false)
  assert(Math.abs(r2.point.x - 100) < 1e-6 && Math.abs(r2.point.y - 0) < 1e-6, `对齐+网格 → (100,0)（实际 ${r2.point.x},${r2.point.y}）`)
  // 不满足对齐时退回角度 + 网格
  const r3 = ed.getSnapPoint({ x: 101, y: 101 }, true, { x: 0, y: 0 })
  assert(Math.abs(r3.point.x - r3.point.y) < 1e-6, `无对齐时角度 45°（实际 ${r3.point.x},${r3.point.y}）`)
}

console.log('--- 6. 橡皮擦命令端到端（擦中段 → 两侧保留） ---')
{
  const ed = new Editor(createDocument('t6'))
  ed.commitTrack([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 150, y: 0 }, { x: 200, y: 0 }])
  // 笔画覆盖中段（段 1..2）
  const stroke = [{ x: 60, y: 2 }, { x: 70, y: -2 }, { x: 80, y: 2 }, { x: 100, y: -2 }, { x: 120, y: 2 }]
  ed.executeEraser(stroke)
  const tracks = ed.document.elements.filter(isTrack)
  assert(tracks.length === 2, `擦中段后剩 2 条（实际 ${tracks.length}）`)
  assert(tracks.every((t) => t.points.length === 2), '两条轨道各 2 个折点（端点干净）')
  assert(ed.getTopologyIssues().length === 0, '拓扑检查通过')
  ed.undo()
  assert(ed.document.elements.filter(isTrack).length === 1, '一次 undo 还原')
  assert(ed.getTopologyIssues().length === 0, 'undo 后拓扑检查通过')
  // 擦前段：后段必须保留
  ed.executeEraser([{ x: 10, y: 2 }, { x: 30, y: -2 }, { x: 45, y: 2 }])
  const tracks2 = ed.document.elements.filter(isTrack)
  assert(tracks2.length === 1 && tracks2[0]!.points.length === 4, `擦前段后只剩后段 4 个折点（实际 ${tracks2.length} 条）`)
  assert(ed.getTopologyIssues().length === 0, '擦前段后拓扑检查通过')
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
