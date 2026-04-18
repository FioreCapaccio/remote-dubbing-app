import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ error, errorInfo });
    console.error("DIAGNOSTIC ERROR CATCH:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '40px',
          background: '#1a1a1a',
          color: '#ff4d4d',
          height: '100vh',
          fontFamily: 'monospace',
          overflow: 'auto',
          border: '4px solid #ff4d4d'
        }}>
          <h1 style={{ fontSize: '24px', marginBottom: '20px' }}>⚠️ DIAGNOSTIC CRASH REPORT ⚠️</h1>
          <p style={{ fontSize: '18px', fontWeight: 'bold' }}> {this.state.error?.toString()} </p>
          <pre style={{ 
            marginTop: '20px', 
            background: '#000', 
            padding: '20px', 
            borderRadius: '8px', 
            fontSize: '12px',
            color: '#888'
          }}>
            {this.state.errorInfo?.componentStack}
          </pre>
          <button 
            onClick={() => window.location.reload()}
            style={{
              marginTop: '20px',
              padding: '10px 20px',
              background: '#ff4d4d',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            RETRY LOADING
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
