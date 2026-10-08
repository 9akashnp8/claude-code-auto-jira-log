export type Unpushed = {
  branch: string
  // Whether the branch tracks origin/<branch>; false for a branch never pushed.
  isPublished: boolean
  ahead: number
}

declare module 'claude-code' {
  interface PluginState {
    'git-push': {
      unpushed: Unpushed | null
      isPushing: boolean
    }
  }
}
