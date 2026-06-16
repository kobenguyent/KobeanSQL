import React, { Component, ReactNode } from 'react'

export class RenderGuard extends Component<{ children: ReactNode, fallback: ReactNode | ((e: Error) => ReactNode), onError?: (e: Error) => void }, { e: Error | null }> {
  state = { e: null as Error | null }
  static getDerivedStateFromError(e: Error) { return { e } }
  componentDidCatch(e: Error) { this.props.onError?.(e) }
  render() {
    const { e } = this.state, { fallback, children } = this.props
    return e ? (typeof fallback === 'function' ? fallback(e) : fallback) : children
  }
}
