<script>
  export let height = '1rem';
  export let width = '100%';
  export let radius = 'var(--radius-md)';
</script>

<div
  class="skeleton"
  style="height:{height};width:{width};border-radius:{radius}"
>
  <div class="shimmer"></div>
</div>

<style>
  .skeleton {
    background: var(--surface-soft);
    position: relative;
    overflow: hidden;
  }

  .shimmer {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      transparent,
      rgba(255, 255, 255, 0.04),
      transparent
    );
    animation: shimmer 1.5s infinite;
  }

  :global(:root[data-theme='light']) .shimmer {
    background: linear-gradient(
      90deg,
      transparent,
      rgba(255, 255, 255, 0.6),
      transparent
    );
  }

  @keyframes shimmer {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(100%);
    }
  }
</style>
