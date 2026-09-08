export function popupPortalContainer(element: HTMLElement | null) {
  return (
    element?.closest<HTMLElement>('[data-ui-portal-container], dialog') ??
    document.body
  );
}
