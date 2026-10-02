import type { MermaidConfig } from 'mermaid';

export function mermaidTheme(
  style: CSSStyleDeclaration,
  darkMode: boolean,
): MermaidConfig {
  const token = (name: string) => style.getPropertyValue(name).trim();
  const text = token('--color-text');
  const muted = token('--color-text-muted');
  const surface = token('--color-surface-muted');
  const node = token('--color-control-selected');
  const border = token('--color-control-border-hover');
  const fills = Array.from({ length: 6 }, (_, index) =>
    token(`--color-diagram-fill-${index + 1}`),
  );
  const series = Array.from({ length: 6 }, (_, index) =>
    token(`--color-diagram-series-${index + 1}`),
  );
  const categories = Object.fromEntries(
    Array.from({ length: 12 }, (_, index) => [
      [`cScale${index}`, fills[index % 6]],
      [`cScaleLabel${index}`, text],
      [`cScaleInv${index}`, text],
      [`cScalePeer${index}`, surface],
      [`pie${index + 1}`, fills[index % 6]],
      [`fillType${index}`, fills[index % 6]],
      [`git${index}`, series[index % 6]],
      [`gitInv${index}`, surface],
      [`gitBranchLabel${index}`, token('--color-text-emphasis')],
      [`venn${index + 1}`, series[index % 6]],
    ]).flat(),
  );
  // C4's built-in node text is white. Keep its blocks on a contrast-safe
  // midtone palette in either theme, rather than the default saturated blue.
  const c4 = Object.fromEntries(
    ['person', 'system', 'container', 'component'].flatMap((kind, index) =>
      ['', 'external_'].flatMap((prefix) =>
        ['', '_db', '_queue'].flatMap((suffix) => [
          [
            `${prefix}${kind}${suffix}_bg_color`,
            (darkMode ? fills : series)[prefix ? 2 : index],
          ],
          [`${prefix}${kind}${suffix}_border_color`, border],
          [`${prefix}${kind}${suffix}FontFamily`, token('--font-ui')],
          [`${prefix}${kind}${suffix}FontSize`, 14],
        ]),
      ),
    ),
  );
  return {
    theme: 'base',
    look: 'classic',
    fontFamily: token('--font-ui'),
    c4: {
      ...c4,
      messageFontFamily: token('--font-ui'),
      boundaryFontFamily: token('--font-ui'),
    },
    radar: {
      marginTop: 70,
      marginRight: 100,
      marginBottom: 70,
      marginLeft: 100,
    },
    // Radar shares cScale with node diagrams, but needs brighter series strokes
    // and translucent areas rather than opaque, text-bearing category fills.
    themeCSS: [
      series
        .map(
          (color, index) =>
            `.radarCurve-${index}, .radarLegendBox-${index} { fill: ${color}; stroke: ${color}; }`,
        )
        .join('\n'),
      '.radarGraticule { fill: none; }',
      '[class^="radarLegendBox-"] { fill-opacity: 1; }',
      '.links .link { mix-blend-mode: normal; }',
      '.node rect.basic, rect.actor { rx: 6px; ry: 6px; }',
      // Crepe paragraph padding must not change Mermaid's measured HTML labels.
      'foreignObject p { padding: 0; }',
    ].join('\n'),
    themeVariables: {
      darkMode,
      background: surface,
      fontFamily: token('--font-ui'),
      fontSize: '14px',
      radius: 6,
      useGradient: false,
      dropShadow: 'none',
      textColor: text,
      titleColor: text,
      primaryColor: node,
      primaryTextColor: text,
      primaryBorderColor: border,
      nodeBorder: border,
      lineColor: muted,
      arrowheadColor: muted,
      secondaryColor: token('--color-info-muted'),
      secondaryTextColor: text,
      secondaryBorderColor: border,
      tertiaryColor: surface,
      tertiaryTextColor: text,
      tertiaryBorderColor: border,
      clusterBkg: surface,
      clusterBorder: border,
      edgeLabelBackground: surface,
      labelBackgroundColor: surface,
      relationLabelBackground: surface,
      relationLabelColor: text,
      actorBkg: token('--color-info-muted'),
      actorBorder: border,
      actorLineColor: muted,
      activationBkgColor: fills[0],
      activationBorderColor: border,
      noteBkgColor: fills[4],
      noteBorderColor: border,
      noteTextColor: text,
      sequenceNumberColor: surface,
      rowOdd: surface,
      rowEven: token('--color-surface-hover'),
      attributeBackgroundColorOdd: surface,
      attributeBackgroundColorEven: token('--color-surface-hover'),
      sectionBkgColor: surface,
      altSectionBkgColor: surface,
      sectionBkgColor2: token('--color-surface-hover'),
      gridColor: token('--color-control-border'),
      taskBkgColor: fills[1],
      taskBorderColor: border,
      activeTaskBkgColor: fills[0],
      activeTaskBorderColor: border,
      doneTaskBkgColor: fills[5],
      doneTaskBorderColor: border,
      critBkgColor: fills[3],
      critBorderColor: border,
      todayLineColor: token('--color-danger'),
      pieTitleTextSize: '18px',
      pieSectionTextSize: '14px',
      pieLegendTextSize: '14px',
      pieStrokeColor: surface,
      pieStrokeWidth: '2px',
      pieOuterStrokeColor: surface,
      pieOuterStrokeWidth: '0px',
      pieOpacity: '1',
      quadrant1Fill: fills[1],
      quadrant2Fill: fills[0],
      quadrant3Fill: fills[3],
      quadrant4Fill: fills[2],
      quadrant1TextFill: text,
      quadrant2TextFill: text,
      quadrant3TextFill: text,
      quadrant4TextFill: text,
      quadrantPointFill: text,
      quadrantPointTextFill: text,
      quadrantInternalBorderStrokeFill: surface,
      quadrantExternalBorderStrokeFill: surface,
      requirementBackground: node,
      requirementBorderColor: border,
      usecaseBkg: node,
      usecaseBorder: border,
      usecaseActorBorder: muted,
      usecaseBoundaryBorder: border,
      archEdgeColor: muted,
      archEdgeArrowColor: muted,
      archGroupBorderColor: border,
      archEdgeWidth: '1.5',
      archGroupBorderWidth: '1px',
      emUiFill: fills[5],
      emUiStroke: border,
      emProcessorFill: fills[2],
      emProcessorStroke: border,
      emReadModelFill: fills[0],
      emReadModelStroke: border,
      emCommandFill: fills[1],
      emCommandStroke: border,
      emEventFill: fills[3],
      emEventStroke: border,
      emSwimlaneBackgroundOdd: surface,
      emSwimlaneBackgroundStroke: token('--color-border'),
      ...categories,
      cynefin: {
        domainFontSize: 18,
        itemFontSize: 14,
        complexBg: fills[0],
        complicatedBg: fills[1],
        chaoticBg: fills[3],
        clearBg: fills[4],
        confusionBg: fills[2],
        textColor: text,
        labelColor: text,
        boundaryColor: border,
        boundaryWidth: 1,
        cliffColor: token('--color-danger'),
        cliffWidth: 2,
      },
      radar: {
        axisColor: text,
        axisStrokeWidth: 1,
        axisLabelFontSize: 14,
        curveOpacity: 0.2,
        curveStrokeWidth: 2,
        graticuleColor: border,
        graticuleOpacity: 0.15,
        legendFontSize: 14,
      },
      xyChart: { plotColorPalette: series.join(',') },
      wardley: {
        backgroundColor: surface,
        axisColor: muted,
        axisTextColor: text,
        gridColor: border,
        componentFill: fills[0],
        componentStroke: border,
        componentLabelColor: text,
        linkStroke: muted,
        evolutionStroke: series[3],
        annotationTextColor: text,
        annotationFill: surface,
      },
      treeView: { labelColor: text, lineColor: muted, descriptionColor: muted },
      packet: {
        startByteColor: text,
        endByteColor: text,
        labelColor: text,
        titleColor: text,
        blockFillColor: fills[1],
        blockStrokeColor: border,
      },
    },
  };
}

// These Mermaid 12 renderers bypass themeVariables for a few default paints.
// Adapt only those known defaults after strict SVG sanitation; document source
// and other author-specified colors remain untouched.
export function adaptMermaidDefaultPaints(
  root: HTMLElement,
  diagramType: string,
  style: CSSStyleDeclaration,
) {
  const token = (name: string) => style.getPropertyValue(name).trim();
  if (diagramType === 'c4') {
    root
      .querySelectorAll('svg text[fill="#444444"], svg text[fill="black"]')
      .forEach((text) => text.setAttribute('fill', token('--color-text')));
    root
      .querySelectorAll('svg [stroke="#444444"], svg marker [stroke="#000000"]')
      .forEach((line) =>
        line.setAttribute('stroke', token('--color-text-muted')),
      );
    root
      .querySelectorAll('svg marker [fill="black"]')
      .forEach((marker) =>
        marker.setAttribute('fill', token('--color-text-muted')),
      );
  }
  if (diagramType === 'sankey') {
    const defaults = [
      '#4e79a7',
      '#f28e2c',
      '#e15759',
      '#76b7b2',
      '#59a14f',
      '#edc949',
      '#af7aa1',
      '#ff9da7',
      '#9c755f',
      '#bab0ab',
    ];
    for (const paint of root.querySelectorAll(
      'svg .nodes rect, svg stop, svg .links path',
    )) {
      for (const attribute of ['fill', 'stroke', 'stop-color']) {
        const index = defaults.indexOf(
          paint.getAttribute(attribute)?.toLowerCase() ?? '',
        );
        if (index >= 0)
          paint.setAttribute(
            attribute,
            token(`--color-diagram-series-${(index % 6) + 1}`),
          );
      }
    }
  }
  if (diagramType === 'wardley') {
    root
      .querySelectorAll(
        'svg text[fill="black"], svg text[fill="#000000"], svg text[fill="#000"]',
      )
      .forEach((text) => text.setAttribute('fill', token('--color-text')));
    root
      .querySelectorAll('svg .wardley-stages line[stroke="#000"]')
      .forEach((line) =>
        line.setAttribute('stroke', token('--color-text-muted')),
      );
  }
}
