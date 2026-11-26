import type { RailDocument } from '../types'
import { Editor } from './core/Editor'

/**
 * 创建 Editor Core。工厂存在的意义是让 Vue / 测试 / 未来多实例
 * 都通过同一入口构建，不直接散落 new Editor(...)。
 */
export function createEditor(doc: RailDocument): Editor {
  return new Editor(doc)
}
