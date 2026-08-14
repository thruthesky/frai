<script lang="ts">
  import { ICONS, type IconName } from './icons'

  interface Props {
    name: IconName
    /** 픽셀 크기. 글자 옆에 놓을 때는 14, 단독 버튼은 16 이 기본이다. */
    size?: number
  }

  let { name, size = 16 }: Props = $props()
</script>

<!--
  aria-hidden 인 이유: 아이콘은 장식이고 의미는 버튼이 갖는다. 아이콘만 있는 버튼에는
  호출부가 aria-label 을 달아야 한다 — 그러지 않으면 이름 없는 버튼이 되어, 문자 ✕ 를
  쓰던 이전보다 접근성이 나빠진다(스크린리더는 문자는 읽지만 aria-hidden SVG 는 건너뛴다).
-->
<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.75"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"
>
  <path d={ICONS[name]} />
</svg>

<style>
  svg {
    display: block;
    flex: none;
  }
</style>
