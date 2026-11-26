import type { DirectionMarkerElement, RailDocument, TrackElement } from '../../types'
import type { Camera } from '../core/Camera'
import { isDirectionMarker, isTrack } from '../model/Document'
import type { Editor } from '../core/Editor'

/** 线路端点方向标识：角度完全由 Track 端点切线自动计算。 */
export class DirectionMarkerRenderer {
  render(ctx: CanvasRenderingContext2D, camera: Camera, doc: RailDocument, editor: Editor): void {
    ctx.save()
    ctx.transform(camera.zoom, 0, 0, camera.zoom, camera.offsetX, camera.offsetY)
    for (const el of doc.elements) {
      if (!isDirectionMarker(el)) continue
      if (!el.visible) continue
      const layer = doc.layers.find((l) => l.id === el.layerId)
      if (layer && !layer.visible) continue
      const track = doc.elements.find((e): e is TrackElement => isTrack(e) && e.id === el.trackId)
      if (!track || track.points.length < 2) continue
      this.renderMarker(ctx, camera, editor, el, track)
    }
    ctx.restore()
  }

  private renderMarker(ctx: CanvasRenderingContext2D, camera: Camera, editor: Editor, marker: DirectionMarkerElement, track: TrackElement): void {
    const dir = editor.getTrackEndpointDirection(track, marker.endpoint)
    const angle = Math.atan2(dir.y, dir.x)
    const ux = Math.cos(angle)
    const uy = Math.sin(angle)
    const p = marker.endpoint === 'start' ? track.points[0] : track.points[track.points.length - 1]
    const arrowSign = marker.arrow === 'inward' ? -1 : 1
    const arrowBase = { x: p.x + ux * marker.offset * arrowSign, y: p.y + uy * marker.offset * arrowSign }
    const arrowTip = { x: p.x + ux * (marker.offset + marker.arrowSize) * arrowSign, y: p.y + uy * (marker.offset + marker.arrowSize) * arrowSign }
    const fontSize = marker.fontSize

    if (marker.arrow !== 'none') {
      ctx.strokeStyle = '#1f2933'
      ctx.lineWidth = marker.strokeWidth
      const wing = marker.arrowSize * 0.38
      ctx.beginPath()
      ctx.moveTo(arrowBase.x, arrowBase.y)
      ctx.lineTo(arrowTip.x, arrowTip.y)
      ctx.moveTo(arrowTip.x, arrowTip.y)
      ctx.lineTo(arrowTip.x - ux * wing + uy * wing * 0.7, arrowTip.y - uy * wing - ux * wing * 0.7)
      ctx.moveTo(arrowTip.x, arrowTip.y)
      ctx.lineTo(arrowTip.x - ux * wing - uy * wing * 0.7, arrowTip.y - uy * wing + ux * wing * 0.7)
      ctx.stroke()
    }

    const textDist = marker.offset + marker.textOffset
    const tx = p.x + ux * textDist * arrowSign
    const ty = p.y + uy * textDist * arrowSign
    let textAngle = angle
    let flip = false
    if (marker.textOrientation === 'follow') {
      const deg = ((angle * 180) / Math.PI + 360) % 360
      if (deg > 90 && deg < 270) {
        flip = true
        textAngle = angle + Math.PI
      }
    } else {
      textAngle = 0
    }
    ctx.save()
    ctx.translate(tx, ty)
    ctx.rotate(textAngle)
    if (flip) ctx.scale(-1, -1)
    ctx.font = `${fontSize}px system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`
    ctx.fillStyle = '#111827'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(marker.text, 0, 0)
    ctx.restore()
  }
}
