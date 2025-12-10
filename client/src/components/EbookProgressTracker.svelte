<!-- EbookProgressTracker.svelte -->
<!-- 
  Phase 2: Frontend Progress UI Component [SEQ-FRONTEND-002]
  
  Purpose: Display real-time ebook generation progress via SSE events
  Consumes: /api/ebook/generate-with-progress SSE stream
  Displays: Quota bar, time countdown, chapter log, error messages
  
  Architecture:
  - Props: url (SSE endpoint URL)
  - State: quotaPercent, timeRemaining, chapters[], currentCall, errors
  - Listeners: EventSource with 8 event types
  - Reactive: All updates trigger UI re-renders
-->

<script lang="ts">
  import Spinner from './Spinner.svelte';

  // Props
  export let url = null; // SSE endpoint URL (e.g., /api/ebook/generate-with-progress?...)
  export let onComplete = null; // Callback when generation completes
  export let onError = null; // Callback on error

  // State
  let quotaPercent = 0;
  let quotaCallsInWindow = 0;
  let quotaLimit = 20;
  
  let timeRemaining = '10:00'; // MM:SS format
  let timeBudgetMs = 0;
  let timeElapsedMs = 0;
  let isTimeTight = false;
  let timeUrgency = 'normal'; // normal | high | critical
  
  let currentCall = ''; // Current operation display
  let chapters = []; // [ { index, type, duration, status }, ... ]
  
  let errorMessage = null;
  let errorIsRetriable = false;
  let isHealthy = true; // !errorMessage && !isTimeTight
  
  let isConnecting = true;
  let isGenerating = false;
  let isComplete = false;
  
  let eventSource = null;

  // Formats milliseconds to MM:SS display
  function formatTime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
  }

  // Connects to SSE endpoint and handles all events
  function connect() {
    if (!url) {
      errorMessage = 'No SSE endpoint URL provided';
      isConnecting = false;
      isHealthy = false;
      return;
    }

    isConnecting = true;
    isGenerating = true;
    errorMessage = null;
    isComplete = false;
    chapters = [];
    currentCall = '';
    quotaPercent = 0;
    timeRemaining = '10:00';

    try {
      eventSource = new EventSource(url);

      // Handle quota-update events
      eventSource.addEventListener('quota-update', (event) => {
        try {
          const { callsInWindow, percentUsed, isExhausted } = JSON.parse(event.data);
          quotaPercent = percentUsed;
          quotaCallsInWindow = callsInWindow;
          isHealthy = !isExhausted;
          isConnecting = false;
        } catch (err) {
          console.error('[Progress] Failed to parse quota-update event:', err);
        }
      });

      // Handle time-update events
      eventSource.addEventListener('time-update', (event) => {
        try {
          const { budgetMs, percentUsed, isExceeded } = JSON.parse(event.data);
          timeBudgetMs = budgetMs;
          timeRemaining = formatTime(budgetMs - (budgetMs * percentUsed / 100));
          isHealthy = !isExceeded;
        } catch (err) {
          console.error('[Progress] Failed to parse time-update event:', err);
        }
      });

      // Handle time-tight warning events
      eventSource.addEventListener('time-tight', (event) => {
        try {
          const { percentUsed, remaining, urgency } = JSON.parse(event.data);
          isTimeTight = true;
          timeUrgency = urgency; // 'high' or 'critical'
          timeRemaining = formatTime(remaining);
          isHealthy = urgency !== 'critical';
        } catch (err) {
          console.error('[Progress] Failed to parse time-tight event:', err);
        }
      });

      // Handle call-start events
      eventSource.addEventListener('call-start', (event) => {
        try {
          const { callIndex, callType, model } = JSON.parse(event.data);
          const modelLabel = model === 'gemini-2.5-pro' ? 'Pro' : 'Flash';
          currentCall = `${callType} (${modelLabel})`;
        } catch (err) {
          console.error('[Progress] Failed to parse call-start event:', err);
        }
      });

      // Handle call-complete events
      eventSource.addEventListener('call-complete', (event) => {
        try {
          const { callIndex, callType, durationMs, status } = JSON.parse(event.data);
          chapters.push({
            index: callIndex,
            type: callType,
            duration: durationMs,
            status: 'complete',
          });
          chapters = [...chapters]; // Trigger reactivity
        } catch (err) {
          console.error('[Progress] Failed to parse call-complete event:', err);
        }
      });

      // Handle call-deferred events
      eventSource.addEventListener('call-deferred', (event) => {
        try {
          const { callIndex, callType, reason, waitMs } = JSON.parse(event.data);
          chapters.push({
            index: callIndex,
            type: callType,
            reason,
            waitMs,
            status: 'deferred',
          });
          chapters = [...chapters]; // Trigger reactivity
        } catch (err) {
          console.error('[Progress] Failed to parse call-deferred event:', err);
        }
      });

      // Handle error events
      eventSource.addEventListener('error', (event) => {
        try {
          const messageEvent = event as MessageEvent;
          if (!messageEvent.data) {
            // Connection error, not a message event
            throw new Error('Connection lost');
          }
          const data = JSON.parse(messageEvent.data);
          errorMessage = `${data.code}: ${data.message}`;
          errorIsRetriable = data.isRetriable;
          isHealthy = false;
          isGenerating = false;
          eventSource.close();
          
          if (onError) {
            onError({ code: data.code, message: data.message, isRetriable: data.isRetriable });
          }
        } catch (err) {
          console.error('[Progress] Failed to parse error event:', err);
        }
      });

      // Handle complete events
      eventSource.addEventListener('complete', (event) => {
        try {
          const { totalCalls, totalTime, success } = JSON.parse(event.data);
          currentCall = 'Complete!';
          isComplete = true;
          isGenerating = false;
          eventSource.close();
          
          if (onComplete) {
            onComplete({ totalCalls, totalTime, success });
          }
        } catch (err) {
          console.error('[Progress] Failed to parse complete event:', err);
        }
      });

      // Handle connection errors
      eventSource.onerror = () => {
        errorMessage = 'Connection lost';
        errorIsRetriable = true;
        isHealthy = false;
        isGenerating = false;
        eventSource.close();
      };

    } catch (err) {
      errorMessage = `Failed to connect: ${err.message}`;
      isHealthy = false;
      isGenerating = false;
      isConnecting = false;
    }
  }

  // Cleanup on unmount
  function cleanup() {
    if (eventSource) {
      eventSource.close();
    }
  }

  // Auto-connect when url is provided
  $: if (url && !eventSource) {
    connect();
  }

  // Cleanup on destroy
  import { onDestroy } from 'svelte';
  onDestroy(cleanup);
</script>

<div class="ebook-progress" class:healthy={isHealthy} class:warning={isTimeTight && !isHealthy} class:error={errorMessage}>
  {#if isConnecting}
    <div class="connecting">
      <Spinner size={32} ariaLabel="Connecting to progress stream..." />
      <p>Connecting to generation stream...</p>
    </div>
  {:else if errorMessage}
    <div class="error-container">
      <div class="error-icon">❌</div>
      <div class="error-content">
        <h3>Generation Failed</h3>
        <p class="error-message">{errorMessage}</p>
        {#if errorIsRetriable}
          <p class="error-hint">This is a temporary error. The system will retry automatically.</p>
        {:else}
          <p class="error-hint">This is a permanent error. Please check your configuration and try again.</p>
        {/if}
      </div>
    </div>
  {:else}
    <!-- Quota Bar -->
    <div class="progress-section">
      <div class="label">API Quota</div>
      <div class="progress-bar">
        <div class="fill" style="width: {quotaPercent}%"></div>
        <span class="percent">{Math.round(quotaPercent)}%</span>
      </div>
      <div class="quota-info">
        {quotaCallsInWindow} / {quotaLimit} calls
      </div>
    </div>

    <!-- Time Budget -->
    <div class="progress-section">
      <div class="label">Time Remaining</div>
      <div class="time-display" class:warning={isTimeTight} class:critical={timeUrgency === 'critical'}>
        {timeRemaining}
      </div>
      {#if isTimeTight}
        <div class="time-warning">
          ⚠️ {timeUrgency === 'critical' ? 'Critical' : 'High'} time pressure
        </div>
      {/if}
    </div>

    <!-- Current Call -->
    <div class="progress-section">
      <div class="label">Current Operation</div>
      <div class="current-call">
        {#if isGenerating}
          <Spinner size={16} ariaLabel="Generating..." />
          <span>{currentCall || 'Starting...'}</span>
        {:else if isComplete}
          <span class="complete-icon">✓</span>
          <span>{currentCall || 'Completed'}</span>
        {:else}
          <span class="idle-icon">—</span>
          <span>Ready</span>
        {/if}
      </div>
    </div>

    <!-- Chapter Progress Log -->
    <div class="progress-section">
      <div class="label">Chapter Progress</div>
      <div class="chapters-list">
        {#if chapters.length === 0}
          <div class="no-chapters">Waiting for structure generation...</div>
        {/if}
        {#each chapters as chapter (chapter.index)}
          <div class="chapter-item {chapter.status}">
            <span class="status-icon">
              {#if chapter.status === 'complete'}
                ✓
              {:else if chapter.status === 'deferred'}
                ⏳
              {/if}
            </span>
            <span class="chapter-name">{chapter.type}</span>
            <span class="chapter-meta">
              {#if chapter.status === 'complete'}
                <span class="duration">{Math.round(chapter.duration)}ms</span>
              {:else if chapter.status === 'deferred'}
                <span class="deferred">deferred, retry in {chapter.waitMs}ms</span>
              {/if}
            </span>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  :root {
    --color-success: #4caf50;
    --color-success-light: #f1f8f4;
    --color-warning: #ff9800;
    --color-warning-light: #fff8f0;
    --color-error: #c62828;
    --color-error-light: #ffebee;
    --color-text-primary: #333;
    --color-text-secondary: #666;
    --color-border: #e0e0e0;
    --color-bg-light: #f8f9fa;
  }

  .ebook-progress {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    padding: 20px;
    border-radius: 8px;
    background: var(--color-bg-light);
    border: 1px solid var(--color-border);
    min-height: 200px;
  }

  .ebook-progress.warning {
    background: #fff3cd;
    border-color: #ffc107;
  }

  .ebook-progress.error {
    background: var(--color-error-light);
    border-color: var(--color-error);
  }

  .connecting {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 40px 20px;
    text-align: center;
  }

  .connecting p {
    color: var(--color-text-secondary);
    font-size: 14px;
  }

  .error-container {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    padding: 16px;
  }

  .error-icon {
    font-size: 32px;
    flex-shrink: 0;
  }

  .error-content {
    flex: 1;
  }

  .error-content h3 {
    margin: 0 0 8px 0;
    color: var(--color-error);
    font-size: 16px;
    font-weight: 600;
  }

  .error-message {
    margin: 0 0 8px 0;
    color: var(--color-text-primary);
    font-size: 14px;
  }

  .error-hint {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: 12px;
    font-style: italic;
  }

  .progress-section {
    margin-bottom: 20px;
  }

  .progress-section:last-child {
    margin-bottom: 0;
  }

  .label {
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text-secondary);
    margin-bottom: 6px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .progress-bar {
    position: relative;
    height: 24px;
    background: #e0e0e0;
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 4px;
  }

  .fill {
    height: 100%;
    background: linear-gradient(90deg, var(--color-success), #66bb6a);
    transition: width 0.3s ease;
  }

  .percent {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text-primary);
    pointer-events: none;
  }

  .quota-info {
    font-size: 12px;
    color: var(--color-text-secondary);
    text-align: right;
  }

  .time-display {
    font-size: 28px;
    font-weight: bold;
    color: var(--color-text-primary);
    font-family: 'Monaco', 'Courier New', monospace;
    transition: color 0.3s ease;
  }

  .time-display.warning {
    color: var(--color-warning);
  }

  .time-display.critical {
    color: var(--color-error);
    animation: pulse 1s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }

  .time-warning {
    font-size: 12px;
    color: var(--color-warning);
    margin-top: 4px;
  }

  .current-call {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px;
    background: #e3f2fd;
    border-radius: 4px;
    font-size: 14px;
    color: #1565c0;
    min-height: 44px;
  }

  .complete-icon {
    font-size: 18px;
    color: var(--color-success);
  }

  .idle-icon {
    font-size: 18px;
    color: var(--color-text-secondary);
  }

  .chapters-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .no-chapters {
    padding: 12px;
    background: white;
    border-radius: 4px;
    border-left: 3px solid var(--color-text-secondary);
    color: var(--color-text-secondary);
    font-size: 13px;
    font-style: italic;
  }

  .chapter-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    background: white;
    border-radius: 4px;
    border-left: 3px solid #999;
    transition: all 0.2s ease;
  }

  .chapter-item.complete {
    border-left-color: var(--color-success);
    background: var(--color-success-light);
  }

  .chapter-item.deferred {
    border-left-color: var(--color-warning);
    background: var(--color-warning-light);
  }

  .status-icon {
    font-weight: bold;
    width: 20px;
    text-align: center;
    font-size: 16px;
  }

  .chapter-name {
    flex: 1;
    font-size: 14px;
    color: var(--color-text-primary);
    font-weight: 500;
  }

  .chapter-meta {
    display: flex;
    gap: 8px;
    font-size: 12px;
    color: var(--color-text-secondary);
  }

  .duration {
    font-family: 'Monaco', 'Courier New', monospace;
  }

  .deferred {
    color: var(--color-warning);
    font-style: italic;
  }

  /* Responsive Design */
  @media (max-width: 600px) {
    .ebook-progress {
      padding: 16px;
    }

    .progress-section {
      margin-bottom: 16px;
    }

    .time-display {
      font-size: 24px;
    }

    .current-call {
      font-size: 12px;
      padding: 10px;
      min-height: 40px;
    }

    .chapter-item {
      padding: 8px 10px;
      font-size: 12px;
    }

    .chapter-meta {
      flex-direction: column;
      gap: 2px;
    }
  }
</style>
