/** 可撤销命令的最小契约。 */
export interface Command {
  readonly label: string
  execute(): void
  undo(): void
}
