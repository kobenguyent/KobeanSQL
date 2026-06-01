import React from 'react'

interface Props {
  children: React.ReactNode
  fallback: React.ReactNode | ((error: Error | null) => React.ReactNode)
  onError?: (error: Error) => void
}

interface State {
  hasError: boolean
  error: Error | null
}

export class RenderGuard extends React.Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error): void {
    this.props.onError?.(error)
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return typeof this.props.fallback === 'function'
        ? this.props.fallback(this.state.error)
        : this.props.fallback
    }
    return this.props.children
  }
}
