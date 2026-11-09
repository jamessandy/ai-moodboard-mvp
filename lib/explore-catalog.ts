import { Tag } from '@/lib/tags'

// ── Directory Categories & Tree Structure ────────────────────────────────────

export const DIRECTORY_BRANCH_IDS = [
  'all',
  'video_clips',
  'cover_art',
  'design_editorial',
  'photography',
  'fonts',
  'color_codes',
  'tools',
] as const

export type DirectoryBranchId = (typeof DIRECTORY_BRANCH_IDS)[number]

// Legacy categories preserved for backward compatibility
export const EXPLORE_CATEGORIES = [
  'inspiration',
  'visual_reference',
  'stock',
  'mockups_templates',
  'video_clips',
  'cover_art',
  'design_editorial',
  'photography',
  'fonts',
  'color_codes',
  'tools',
] as const

export type ExploreCategory = (typeof EXPLORE_CATEGORIES)[number]

export type DirectoryBranch = {
  id: DirectoryBranchId
  label: string
  icon: string
  tagline: string
  subBranches: string[]
}

export const DIRECTORY_BRANCHES: DirectoryBranch[] = [
  {
    id: 'video_clips',
    label: 'Video & Clip Ideas',
    icon: '🎬',
    tagline: 'Vertical reels, hook ideas, opening title sequences, motion archives & film keyframes',
    subBranches: ['Reels & TikTok Hooks', 'Title Sequences', 'Motion & Transitions', 'Film Keyframes', 'Free Footage'],
  },
  {
    id: 'cover_art',
    label: 'Cover Art & Music Design',
    icon: '💿',
    tagline: 'Album artwork, magazine editorial covers, vinyl gatefolds & music packaging',
    subBranches: ['Album Covers', 'Magazine Art Direction', 'Vinyl & Physical Media', 'Gig Posters', 'Typography Layouts'],
  },
  {
    id: 'design_editorial',
    label: 'Design & Editorial',
    icon: '🎨',
    tagline: 'Graphic systems, poster archives, zines, spatial typography & visual identity',
    subBranches: ['Editorial Layouts', 'Brand Identity', 'Typography in Use', 'Zines & Collages', 'Posters & Grid'],
  },
  {
    id: 'photography',
    label: 'Photography & Stills',
    icon: '📸',
    tagline: 'Visual cores, cinematic lighting, 35mm analog tone & raw documentary portraiture',
    subBranches: ['Visual Cores', 'Cinematic Lighting', '35mm Analog & Grain', 'Street & Documentary', 'Color References'],
  },
  {
    id: 'fonts',
    label: 'Typography & Fonts',
    icon: '🔤',
    tagline: 'Open-source display foundries, experimental typefaces & specimen archives',
    subBranches: ['Free Display Type', 'Open-source Foundries', 'Type Specimen Lookbooks', 'Experimental & Weird'],
  },
  {
    id: 'color_codes',
    label: 'Color Codes & Palettes',
    icon: '🌈',
    tagline: 'Hex colorway generators, official brand color codes, AI palettes & CSS gradients',
    subBranches: ['Palette Generators', 'Brand Color Codes', 'AI Harmonizers', 'Color Search Engines', 'CSS Gradients'],
  },
  {
    id: 'tools',
    label: 'Mockups & Creator Tools',
    icon: '🛠️',
    tagline: 'Device mockup studios, browser shaders, 3D web canvases & creative utilities',
    subBranches: ['Device Mockups', 'Browser Shaders & FX', 'Interactive 3D', 'Creative Utilities'],
  },
]

export const EXPLORE_CATEGORY_LABELS: Record<string, string> = {
  all: 'All Resources',
  video_clips: 'Video & Clip Ideas',
  cover_art: 'Cover Art & Packaging',
  design_editorial: 'Design & Editorial',
  photography: 'Photography & Stills',
  fonts: 'Typography & Fonts',
  color_codes: 'Color Codes & Palettes',
  tools: 'Mockups & Tools',
  inspiration: 'Inspiration',
  visual_reference: 'Visual Reference',
  stock: 'Stock',
  mockups_templates: 'Mockups & Templates',
}

export const EXPLORE_MEDIA_TYPES = [
  'all',
  'images',
  'videos',
  'design',
  'fonts',
  'tool',
] as const

export type ExploreMediaFilter = (typeof EXPLORE_MEDIA_TYPES)[number]

export const EXPLORE_MEDIA_LABELS: Record<ExploreMediaFilter, string> = {
  all: 'All Media',
  images: 'Stills & Images',
  videos: 'Motion & Clips',
  design: 'Layouts & Editorial',
  fonts: 'Typefaces',
  tool: 'Direct Links',
}

export type ExploreMediaType = 'images' | 'videos' | 'design' | 'fonts' | 'template' | 'tool'

export type ExploreItemKind = 'canvas_asset' | 'board_template' | 'external_resource'

export type FontConfig = {
  family: string
  weight?: number
  style?: string
  notes?: string
}

export type ExploreItem = {
  id: string
  title: string
  description?: string
  category: ExploreCategory
  branch: DirectoryBranchId
  sub_branch?: string
  media_type: ExploreMediaType
  item_kind: ExploreItemKind
  media_url?: string
  source_name?: string
  source_url?: string
  search_url_template?: string // URL template with %s for direct search
  palette: string[]
  extracted_tags: Tag[]
  features?: string[]
  font_config?: FontConfig | null
  template_slug?: string | null
}

// ── Directory Items Catalog ──────────────────────────────────────────────────

export const CREATIVE_DIRECTORY: ExploreItem[] = [
  // ── Video & Clip Ideas ─────────────────────────────────────────────────────
  {
    id: 'dir-vidclue',
    title: 'Vidclue',
    description: 'The largest vertical video idea library for brands. Hundreds of hook ideas, storytelling structures, and pacing references for short-form clips.',
    category: 'video_clips',
    branch: 'video_clips',
    sub_branch: 'Reels & TikTok Hooks',
    media_type: 'videos',
    item_kind: 'external_resource',
    source_name: 'Vidclue',
    source_url: 'https://www.vidclue.co',
    search_url_template: 'https://www.google.com/search?q=site:vidclue.co+%s',
    media_url: 'https://images.unsplash.com/photo-1536240478700-b869070f9279?w=600&q=80',
    palette: ['#000000', '#6366f1', '#f0abfc'],
    extracted_tags: ['mood', 'composition', 'subject'],
    features: ['Hook Ideas', 'Viral Pacing', 'Ad References'],
  },
  {
    id: 'dir-art-of-title',
    title: 'Art of the Title',
    description: 'The definitive creative archive honoring movie, television, and game title design, motion graphics, and kinetic typography sequences.',
    category: 'video_clips',
    branch: 'video_clips',
    sub_branch: 'Title Sequences',
    media_type: 'videos',
    item_kind: 'external_resource',
    source_name: 'Art of the Title',
    source_url: 'https://www.artofthetitle.com',
    search_url_template: 'https://www.artofthetitle.com/?s=%s',
    media_url: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=600&q=80',
    palette: ['#000000', '#e50914', '#ffffff'],
    extracted_tags: ['composition', 'lighting', 'mood'],
    features: ['Opening Credits', 'Interviews', 'Motion Graphics'],
  },
  {
    id: 'dir-eyecandy',
    title: 'Eyecandy',
    description: 'Visual techniques index for filmmakers and motion designers. Browse clips classified by camera moves, lighting tricks, and visual edits.',
    category: 'video_clips',
    branch: 'video_clips',
    sub_branch: 'Motion & Transitions',
    media_type: 'videos',
    item_kind: 'external_resource',
    source_name: 'Eyecandy',
    source_url: 'https://eyecandy.work',
    search_url_template: 'https://www.google.com/search?q=site:eyecandy.work+%s',
    media_url: 'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?w=600&q=80',
    palette: ['#09090b', '#22c55e', '#a1a1aa'],
    extracted_tags: ['lighting', 'composition', 'mood'],
    features: ['Camera Movements', 'Visual Edits', 'Technique Breakdown'],
  },
  {
    id: 'dir-filmgrab',
    title: 'FILMGRAB',
    description: 'Searchable visual library of over 100,000 pristine film stills and cinematic keyframes for visual pitch decks, cinematography, and mood boards.',
    category: 'video_clips',
    branch: 'video_clips',
    sub_branch: 'Film Keyframes',
    media_type: 'images',
    item_kind: 'external_resource',
    source_name: 'FILMGRAB',
    source_url: 'https://film-grab.com',
    search_url_template: 'https://film-grab.com/?s=%s',
    media_url: 'https://images.unsplash.com/photo-1478760329108-5c3ed9d495a0?w=600&q=80',
    palette: ['#0d1117', '#e2b714', '#ffffff'],
    extracted_tags: ['lighting', 'mood', 'composition'],
    features: ['100k+ Stills', 'Aspect Ratios', 'Director Archives'],
  },
  {
    id: 'dir-mixkit-video',
    title: 'Mixkit Video',
    description: 'Curated library of free high-definition stock video clips, aesthetic motion loops, vertical b-roll, and drone establishing shots with zero attribution required.',
    category: 'video_clips',
    branch: 'video_clips',
    sub_branch: 'Free Footage',
    media_type: 'videos',
    item_kind: 'external_resource',
    source_name: 'Mixkit',
    source_url: 'https://mixkit.co/free-stock-video/',
    search_url_template: 'https://mixkit.co/free-stock-video/%s/',
    media_url: 'https://images.unsplash.com/photo-1518173946687-a4c8a383392e?w=600&q=80',
    palette: ['#0284c7', '#0f172a', '#e0f2fe'],
    extracted_tags: ['mood', 'texture'],
    features: ['Free Commercial Use', 'HD B-Roll', 'Motion Backgrounds'],
  },
  {
    id: 'dir-coverr',
    title: 'Coverr',
    description: 'Aesthetic royalty-free footage loops and cinematic visual moods designed for headers, teasers, and vertical video background clips.',
    category: 'video_clips',
    branch: 'video_clips',
    sub_branch: 'Free Footage',
    media_type: 'videos',
    item_kind: 'external_resource',
    source_name: 'Coverr',
    source_url: 'https://coverr.co',
    search_url_template: 'https://coverr.co/s?q=%s',
    media_url: 'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?w=600&q=80',
    palette: ['#1e293b', '#f59e0b', '#f8fafc'],
    extracted_tags: ['lighting', 'mood', 'texture'],
    features: ['Looping Footage', 'Cinematic B-Roll', 'No Watermark'],
  },

  // ── Cover Art & Music Design ───────────────────────────────────────────────
  {
    id: 'dir-coverjunkie',
    title: 'coverjunkie',
    description: 'An iconic celebration of bold magazine cover design, avant-garde typography layouts, and boundary-pushing art directors from around the globe.',
    category: 'cover_art',
    branch: 'cover_art',
    sub_branch: 'Magazine Art Direction',
    media_type: 'design',
    item_kind: 'external_resource',
    source_name: 'coverjunkie',
    source_url: 'https://www.coverjunkie.com',
    search_url_template: 'https://www.google.com/search?q=site:coverjunkie.com+%s',
    media_url: 'https://images.unsplash.com/photo-1586075010923-2dd4570fb338?w=600&q=80',
    palette: ['#ffffff', '#e11d48', '#0f172a'],
    extracted_tags: ['composition', 'color', 'subject'],
    features: ['Magazine Covers', 'Editorial Art', 'Type Focus'],
  },
  {
    id: 'dir-album-art-archive',
    title: 'Album Art Archive',
    description: 'Exhaustive high-resolution directory of record covers, CD booklets, back sleeves, and typography treatments across electronic, hip-hop, indie, and ambient releases.',
    category: 'cover_art',
    branch: 'cover_art',
    sub_branch: 'Album Covers',
    media_type: 'images',
    item_kind: 'external_resource',
    source_name: 'Album Art Archive',
    source_url: 'https://albumartarchive.com',
    search_url_template: 'https://albumartarchive.com/?s=%s',
    media_url: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600&q=80',
    palette: ['#18181b', '#f43f5e', '#fafafa'],
    extracted_tags: ['mood', 'color', 'composition'],
    features: ['High-Res Sleeves', 'Vinyl Inserts', 'Typography Detail'],
  },
  {
    id: 'dir-dave-dye',
    title: "Dave Dye's Pinterest Boards",
    description: "Dave Dye is an art director's art director. His curated boards collect thousands of rare vintage ads, album sleeves, editorial covers, and creative references.",
    category: 'cover_art',
    branch: 'cover_art',
    sub_branch: 'Magazine Art Direction',
    media_type: 'design',
    item_kind: 'external_resource',
    source_name: 'Dave Dye — Pinterest',
    source_url: 'https://www.pinterest.co.uk/davedye/',
    search_url_template: 'https://www.pinterest.com/search/pins/?q=Dave+Dye+%s',
    media_url: 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=600&q=80',
    palette: ['#f5f0e1', '#2c3e50', '#d35400'],
    extracted_tags: ['composition', 'mood', 'color'],
    features: ['Vintage Ads', 'Physical Packaging', 'Masterclass Curation'],
  },
  {
    id: 'dir-poster-poster',
    title: 'Poster Poster',
    description: 'An international celebration of contemporary poster art, festival flyers, Swiss grid systems, and bold screen-printed typography.',
    category: 'cover_art',
    branch: 'cover_art',
    sub_branch: 'Gig Posters',
    media_type: 'design',
    item_kind: 'external_resource',
    source_name: 'Poster Poster',
    source_url: 'https://posterposter.org',
    search_url_template: 'https://posterposter.org/?s=%s',
    media_url: 'https://images.unsplash.com/photo-1561070791-2526d30994b5?w=600&q=80',
    palette: ['#000000', '#ffffff', '#ff3b30'],
    extracted_tags: ['composition', 'color'],
    features: ['Poster Design', 'International Work', 'Graphic Layouts'],
  },
  {
    id: 'dir-sleeveface',
    title: 'Sleeveface',
    description: 'Creative physical illusions where vinyl album art obscures human portraits. A masterclass in creative framing, photography alignment, and physical album sleeves.',
    category: 'cover_art',
    branch: 'cover_art',
    sub_branch: 'Vinyl & Physical Media',
    media_type: 'images',
    item_kind: 'external_resource',
    source_name: 'Sleeveface',
    source_url: 'http://www.sleeveface.com',
    search_url_template: 'https://www.google.com/search?q=site:sleeveface.com+%s',
    media_url: 'https://images.unsplash.com/photo-1539185441755-769473a23570?w=600&q=80',
    palette: ['#292524', '#d97706', '#f5f5f4'],
    extracted_tags: ['composition', 'subject', 'mood'],
    features: ['Vinyl Interaction', 'Portrait Alignments', 'Tactile Media'],
  },

  // ── Graphic Design & Editorial ─────────────────────────────────────────────
  {
    id: 'dir-cosmos',
    title: 'Cosmos',
    description: 'A discovery engine built for creatives. Curate visual references from anywhere on the web, cluster ideas into aesthetic worlds, and discover new visual voices.',
    category: 'design_editorial',
    branch: 'design_editorial',
    sub_branch: 'Mood Clusters',
    media_type: 'design',
    item_kind: 'external_resource',
    source_name: 'Cosmos',
    source_url: 'https://www.cosmos.so',
    search_url_template: 'https://www.cosmos.so/search?q=%s',
    media_url: 'https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=600&q=80',
    palette: ['#0d0d0d', '#ff6b35', '#ebebeb'],
    extracted_tags: ['mood', 'composition'],
    features: ['Visual Engine', 'Creative Clusters', 'No Ads'],
  },
  {
    id: 'dir-arena',
    title: 'Are.na',
    description: 'Contextual idea aggregation. A calm internet garden where designers, researchers, and artists collect images, links, design theory, and zines.',
    category: 'design_editorial',
    branch: 'design_editorial',
    sub_branch: 'Zines & Collages',
    media_type: 'design',
    item_kind: 'external_resource',
    source_name: 'Are.na',
    source_url: 'https://www.are.na',
    search_url_template: 'https://www.are.na/search?q=%s',
    media_url: 'https://images.unsplash.com/photo-1507842229451-7f01be8510ab?w=600&q=80',
    palette: ['#ffffff', '#222222', '#14b8a6'],
    extracted_tags: ['composition', 'mood'],
    features: ['Collaborative Channels', 'Design Research', 'No Algorithms'],
  },
  {
    id: 'dir-fonts-in-use',
    title: 'Fonts In Use',
    description: 'Searchable public archive of real-world typographic design. Indexed by format, aesthetic era, industry, and exact typefaces used.',
    category: 'design_editorial',
    branch: 'design_editorial',
    sub_branch: 'Typography in Use',
    media_type: 'fonts',
    item_kind: 'external_resource',
    source_name: 'Fonts In Use',
    source_url: 'https://fontsinuse.com',
    search_url_template: 'https://fontsinuse.com/search?q=%s',
    media_url: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=600&q=80',
    palette: ['#1c1917', '#e11d48', '#fafaf9'],
    extracted_tags: ['composition', 'texture'],
    features: ['Real-World Specs', 'Era Filtering', 'Type Combinations'],
  },
  {
    id: 'dir-brand-new',
    title: 'Brand New (UnderConsideration)',
    description: 'The premier critique blog documenting corporate, cultural, and sports brand redesigns, comprehensive visual identity systems, and packaging.',
    category: 'design_editorial',
    branch: 'design_editorial',
    sub_branch: 'Brand Identity',
    media_type: 'design',
    item_kind: 'external_resource',
    source_name: 'Brand New',
    source_url: 'https://www.underconsideration.com/brandnew/',
    search_url_template: 'https://www.underconsideration.com/brandnew/?s=%s',
    media_url: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=600&q=80',
    palette: ['#0f172a', '#38bdf8', '#ffffff'],
    extracted_tags: ['composition', 'color'],
    features: ['Brand Case Studies', 'Before / After', 'Identity Systems'],
  },
  {
    id: 'dir-visual-journal',
    title: 'Visual Journal',
    description: 'Curated showcase of the finest graphic design, art direction, and editorial books from independent design studios worldwide.',
    category: 'design_editorial',
    branch: 'design_editorial',
    sub_branch: 'Editorial Layouts',
    media_type: 'design',
    item_kind: 'external_resource',
    source_name: 'Visual Journal',
    source_url: 'https://visualjournal.it',
    search_url_template: 'https://visualjournal.it/?s=%s',
    media_url: 'https://images.unsplash.com/photo-1586717791821-3f44a563fa4c?w=600&q=80',
    palette: ['#f8fafc', '#0f172a', '#ef4444'],
    extracted_tags: ['composition', 'subject'],
    features: ['Editorial Layouts', 'Book Design', 'Modern Minimal'],
  },
  {
    id: 'dir-typographic-posters',
    title: 'Typographic Posters',
    description: 'A curated gallery honoring the beauty of typographic posters, experimental grids, and spatial text relationships.',
    category: 'design_editorial',
    branch: 'design_editorial',
    sub_branch: 'Posters & Grid',
    media_type: 'design',
    item_kind: 'external_resource',
    source_name: 'Typographic Posters',
    source_url: 'https://www.typographicposters.com',
    search_url_template: 'https://www.typographicposters.com/search?q=%s',
    media_url: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=600&q=80',
    palette: ['#000000', '#facc15', '#ffffff'],
    extracted_tags: ['composition', 'mood'],
    features: ['Swiss Grid', 'Spatial Layouts', 'Expressive Type'],
  },

  // ── Photography & Visual Stills ────────────────────────────────────────────
  {
    id: 'dir-ef-cores',
    title: 'EF Visual Cores',
    description: 'Curated directory tracking distinct visual subcultures: Cyberpunk, Solarpunk, Brutalism, Y2K Aesthetics, Acid Graphics, and Dark Academia.',
    category: 'photography',
    branch: 'photography',
    sub_branch: 'Visual Cores',
    media_type: 'images',
    item_kind: 'external_resource',
    source_name: 'EF Visual Cores',
    source_url: 'https://ru.pinterest.com/electroformaint/ef-visual-cores/',
    search_url_template: 'https://www.pinterest.com/search/pins/?q=visual+core+%s',
    media_url: 'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?w=600&q=80',
    palette: ['#0f051d', '#00ffcc', '#ff007f'],
    extracted_tags: ['color', 'mood', 'lighting'],
    features: ['Aesthetic Cores', 'Subculture Moods', 'Color Trends'],
  },
  {
    id: 'dir-shotdeck',
    title: 'ShotDeck',
    description: 'The ultimate visual library for cinematographers and commercial directors. Searchable by camera, lens, lighting setup, time of day, and color palette.',
    category: 'photography',
    branch: 'photography',
    sub_branch: 'Cinematic Lighting',
    media_type: 'images',
    item_kind: 'external_resource',
    source_name: 'ShotDeck',
    source_url: 'https://shotdeck.com',
    search_url_template: 'https://shotdeck.com/welcome/browse?search=%s',
    media_url: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=600&q=80',
    palette: ['#050811', '#06b6d4', '#f59e0b'],
    extracted_tags: ['lighting', 'color', 'composition'],
    features: ['Director Search', 'Lighting Data', 'Aspect Ratios'],
  },
  {
    id: 'dir-magnum-photos',
    title: 'Magnum Photos Collection',
    description: 'Legendary documentary, street, and photojournalism archive. Authentic visual storytelling and unvarnished portraiture from historic masters.',
    category: 'photography',
    branch: 'photography',
    sub_branch: 'Street & Documentary',
    media_type: 'images',
    item_kind: 'external_resource',
    source_name: 'Magnum Photos',
    source_url: 'https://www.magnumphotos.com',
    search_url_template: 'https://www.magnumphotos.com/search/%s/',
    media_url: 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=600&q=80',
    palette: ['#18181b', '#d4d4d8', '#ffffff'],
    extracted_tags: ['subject', 'mood', 'lighting'],
    features: ['Documentary Stills', 'Human Stories', 'Iconic Masters'],
  },
  {
    id: 'dir-film-photo-club',
    title: 'Film Photo Club',
    description: 'Analog photography community celebrating 35mm grain, Kodak Portra halation, medium format tones, and rich vintage color chemistry.',
    category: 'photography',
    branch: 'photography',
    sub_branch: '35mm Analog & Grain',
    media_type: 'images',
    item_kind: 'external_resource',
    source_name: 'Film Photo Club',
    source_url: 'https://filmphotoclub.com',
    search_url_template: 'https://www.google.com/search?q=site:filmphotoclub.com+%s',
    media_url: 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=600&q=80',
    palette: ['#451a03', '#f59e0b', '#fed7aa'],
    extracted_tags: ['texture', 'color', 'lighting'],
    features: ['Analog Grain', 'Portra Chemistry', 'Warm Halation'],
  },
  {
    id: 'dir-unsplash-editorial',
    title: 'Unsplash Curated Editorial',
    description: 'High-resolution photography curated by creative directors with architectural negative space, muted tones, and clean editorial lighting.',
    category: 'photography',
    branch: 'photography',
    sub_branch: 'Color References',
    media_type: 'images',
    item_kind: 'external_resource',
    source_name: 'Unsplash Editorial',
    source_url: 'https://unsplash.com',
    search_url_template: 'https://unsplash.com/s/photos/%s',
    media_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=600&q=80',
    palette: ['#ff8c42', '#2c5d63', '#1e2022'],
    extracted_tags: ['lighting', 'color', 'subject'],
    features: ['High-Res Stills', 'Free Commercial', 'Editorial Clean'],
  },

  // ── Typography & Fonts ─────────────────────────────────────────────────────
  {
    id: 'dir-velvetyne',
    title: 'Velvetyne Type Foundry',
    description: 'Pioneering open-source type foundry. Designs bold, unconventional, and experimental free fonts for personal and commercial creative work.',
    category: 'fonts',
    branch: 'fonts',
    sub_branch: 'Open-source Foundries',
    media_type: 'fonts',
    item_kind: 'external_resource',
    source_name: 'Velvetyne',
    source_url: 'https://velvetyne.fr',
    search_url_template: 'https://www.google.com/search?q=site:velvetyne.fr+%s',
    media_url: 'https://images.unsplash.com/photo-1455659817273-f96807779a8a?w=600&q=80',
    palette: ['#0a0a0a', '#d4a574', '#f5f0e1'],
    extracted_tags: ['mood', 'texture'],
    features: ['100% Free & Libre', 'Experimental', 'Commercial Ready'],
  },
  {
    id: 'dir-collletttivo',
    title: 'Collletttivo',
    description: 'Open-source contemporary type foundry created through an open collective of graphic designers. Sharp editorial and text serif specimens.',
    category: 'fonts',
    branch: 'fonts',
    sub_branch: 'Open-source Foundries',
    media_type: 'fonts',
    item_kind: 'external_resource',
    source_name: 'Collletttivo',
    source_url: 'https://www.collletttivo.it',
    search_url_template: 'https://www.google.com/search?q=site:collletttivo.it+%s',
    media_url: 'https://images.unsplash.com/photo-1524661135-423995f22d0b?w=600&q=80',
    palette: ['#111827', '#64748b', '#f8fafc'],
    extracted_tags: ['composition'],
    features: ['Contemporary Type', 'Open Source', 'Variable Fonts'],
  },
  {
    id: 'dir-typewolf',
    title: 'Typewolf',
    description: 'The definitive typography resource. Discover trending web font combinations, curated lookbooks, font guides, and recommended type pairing lists.',
    category: 'fonts',
    branch: 'fonts',
    sub_branch: 'Type Specimen Lookbooks',
    media_type: 'fonts',
    item_kind: 'external_resource',
    source_name: 'Typewolf',
    source_url: 'https://www.typewolf.com',
    search_url_template: 'https://www.typewolf.com/?s=%s',
    media_url: 'https://images.unsplash.com/photo-1501366062246-723b4d3e4eb6?w=600&q=80',
    palette: ['#1c1917', '#be185d', '#fdf2f8'],
    extracted_tags: ['mood', 'texture'],
    features: ['Font Pairings', 'Site of the Day', 'Curated Guides'],
  },
  {
    id: 'dir-badass-libre-fonts',
    title: 'Badass Libre Fonts',
    description: 'A handpicked collection of high-quality free and open-source fonts for designers that look just as good as premium commercial foundry releases.',
    category: 'fonts',
    branch: 'fonts',
    sub_branch: 'Free Display Type',
    media_type: 'fonts',
    item_kind: 'external_resource',
    source_name: 'Badass Libre Fonts',
    source_url: 'https://badasslibretypefaces.com',
    search_url_template: 'https://www.google.com/search?q=site:badasslibretypefaces.com+%s',
    media_url: 'https://images.unsplash.com/photo-1541701494587-cb58502866ab?w=600&q=80',
    palette: ['#09090b', '#3b82f6', '#f4f4f5'],
    extracted_tags: ['composition', 'mood'],
    features: ['Hand-Curated', 'Commercial Friendly', 'Modern Display'],
  },
  {
    id: 'dir-google-fonts-display',
    title: 'Google Fonts Display',
    description: 'Direct filterable directory of Google Fonts display and expressive typefaces (Anton, Syne, Unifraktur, Bebas Neue) ready for quick text composition.',
    category: 'fonts',
    branch: 'fonts',
    sub_branch: 'Free Display Type',
    media_type: 'fonts',
    item_kind: 'external_resource',
    source_name: 'Google Fonts',
    source_url: 'https://fonts.google.com/?category=Display',
    search_url_template: 'https://fonts.google.com/?query=%s',
    media_url: 'https://images.unsplash.com/photo-1516962215378-7fa2e137ae93?w=600&q=80',
    palette: ['#ea4335', '#4285f4', '#fbbc05'],
    extracted_tags: ['color', 'composition'],
    features: ['Instant CDN', 'Free Commercial', 'Variable Support'],
  },

  // ── Color Codes & Palettes ─────────────────────────────────────────────────
  {
    id: 'dir-coolors',
    title: 'Coolors',
    description: 'The super-fast color palette generator for creatives. Generate harmonious schemes, extract colorways from images, copy hex codes, and test contrast.',
    category: 'color_codes',
    branch: 'color_codes',
    sub_branch: 'Palette Generators',
    media_type: 'design',
    item_kind: 'external_resource',
    source_name: 'Coolors',
    source_url: 'https://coolors.co',
    search_url_template: 'https://coolors.co/palettes/trending/%s',
    media_url: 'https://images.unsplash.com/photo-1541701494587-cb58502866ab?w=600&q=80',
    palette: ['#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51'],
    extracted_tags: ['color', 'mood'],
    features: ['Instant Hex Swatches', 'Contrast Testing', 'Palette Export'],
  },
  {
    id: 'dir-color-hunt',
    title: 'Color Hunt',
    description: 'Open curated collection of thousands of hand-picked color palettes and color codes used by designers, art directors, and web creators worldwide.',
    category: 'color_codes',
    branch: 'color_codes',
    sub_branch: 'Palette Generators',
    media_type: 'design',
    item_kind: 'external_resource',
    source_name: 'Color Hunt',
    source_url: 'https://colorhunt.co',
    search_url_template: 'https://colorhunt.co/palettes/%s',
    media_url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=600&q=80',
    palette: ['#222831', '#393e46', '#00adb5', '#eeeeee'],
    extracted_tags: ['color', 'mood'],
    features: ['Trending Palettes', 'Hex Codes', 'Community Curated'],
  },
  {
    id: 'dir-brandcolors',
    title: 'BrandColors',
    description: 'The biggest collection of official brand color codes around (Spotify, Netflix, Nike, Apple, Supreme, etc.). Instant 1-click copy for exact hex codes.',
    category: 'color_codes',
    branch: 'color_codes',
    sub_branch: 'Brand Color Codes',
    media_type: 'design',
    item_kind: 'external_resource',
    source_name: 'BrandColors',
    source_url: 'https://brandcolors.net',
    search_url_template: 'https://brandcolors.net/?s=%s',
    media_url: 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=600&q=80',
    palette: ['#1db954', '#191414', '#e50914', '#ffffff'],
    extracted_tags: ['color', 'composition'],
    features: ['Official Hex Codes', '1-Click Copy', '1000+ Brands'],
  },
  {
    id: 'dir-khroma',
    title: 'Khroma',
    description: 'AI color tool for designers. Learns your personal aesthetic preferences through neural networks and generates endless personalized harmonious palettes.',
    category: 'color_codes',
    branch: 'color_codes',
    sub_branch: 'AI Harmonizers',
    media_type: 'design',
    item_kind: 'external_resource',
    source_name: 'Khroma',
    source_url: 'https://www.khroma.co',
    search_url_template: 'https://www.google.com/search?q=site:khroma.co+%s',
    media_url: 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?w=600&q=80',
    palette: ['#6366f1', '#a855f7', '#ec4899', '#f43f5e'],
    extracted_tags: ['color', 'mood'],
    features: ['AI Palettes', 'Poster Previews', 'Personalized Match'],
  },
  {
    id: 'dir-adobe-color',
    title: 'Adobe Color',
    description: 'Industry-standard color wheel, triad/complementary/analogous harmony tools, gradient builder, and color palette extraction from uploaded images.',
    category: 'color_codes',
    branch: 'color_codes',
    sub_branch: 'Palette Generators',
    media_type: 'design',
    item_kind: 'external_resource',
    source_name: 'Adobe Color',
    source_url: 'https://color.adobe.com',
    search_url_template: 'https://color.adobe.com/explore?search=%s',
    media_url: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=600&q=80',
    palette: ['#ff0055', '#ff5500', '#ffcc00', '#00ccff'],
    extracted_tags: ['color', 'lighting'],
    features: ['Color Wheel Rules', 'Extract from Photo', 'Accessibility Contrast'],
  },
  {
    id: 'dir-happy-hues',
    title: 'Happy Hues',
    description: 'Curated color palettes shown in real website UI context. Demonstrates how to apply background, headline, and button accent hex codes properly.',
    category: 'color_codes',
    branch: 'color_codes',
    sub_branch: 'Brand Color Codes',
    media_type: 'design',
    item_kind: 'external_resource',
    source_name: 'Happy Hues',
    source_url: 'https://www.happyhues.co',
    search_url_template: 'https://www.google.com/search?q=site:happyhues.co+%s',
    media_url: 'https://images.unsplash.com/photo-1507238691740-187a5b1d37b8?w=600&q=80',
    palette: ['#fffffe', '#272343', '#ffd803', '#e3f6f5'],
    extracted_tags: ['color', 'composition'],
    features: ['In-Context Palettes', 'Hierarchy Guide', 'UI Tested'],
  },
  {
    id: 'dir-picular',
    title: 'Picular',
    description: 'The Google of colors. Enter any conceptual vibe, object, or city (e.g. "tokyo neon", "midnight drive", "matcha") to get instant extracted hex codes.',
    category: 'color_codes',
    branch: 'color_codes',
    sub_branch: 'Color Search Engines',
    media_type: 'design',
    item_kind: 'external_resource',
    source_name: 'Picular',
    source_url: 'https://picular.co',
    search_url_template: 'https://picular.co/%s',
    media_url: 'https://images.unsplash.com/photo-1557683316-973673baf926?w=600&q=80',
    palette: ['#1e1b4b', '#4338ca', '#38bdf8', '#fb7185'],
    extracted_tags: ['color', 'mood'],
    features: ['Vibe-to-Hex Search', '1-Click Copy', 'Dynamic Colorways'],
  },
  {
    id: 'dir-gradient-hunt',
    title: 'Gradient Hunt',
    description: 'Thousands of trendy free color gradients with instant CSS code and hex values for backgrounds, moodboards, and typography overlays.',
    category: 'color_codes',
    branch: 'color_codes',
    sub_branch: 'CSS Gradients',
    media_type: 'design',
    item_kind: 'external_resource',
    source_name: 'Gradient Hunt',
    source_url: 'https://gradienthunt.com',
    search_url_template: 'https://gradienthunt.com/search?q=%s',
    media_url: 'https://images.unsplash.com/photo-1550684376-efcbd6e3f031?w=600&q=80',
    palette: ['#ff758c', '#ff7eb3', '#7028e4', '#e5b2ca'],
    extracted_tags: ['color', 'texture'],
    features: ['CSS Gradient Code', 'Color Stops', 'Free Export'],
  },

  // ── Mockups & Creator Tools ────────────────────────────────────────────────
  {
    id: 'dir-shots-so',
    title: 'Shots.so',
    description: 'Free browser studio for creating clean, high-resolution device mockups for iPhone, iPad, Apple Watch, MacBooks, and sleek browser frames in seconds.',
    category: 'tools',
    branch: 'tools',
    sub_branch: 'Device Mockups',
    media_type: 'design',
    item_kind: 'external_resource',
    source_name: 'Shots.so',
    source_url: 'https://shots.so',
    search_url_template: 'https://www.google.com/search?q=site:shots.so+%s',
    media_url: 'https://images.unsplash.com/photo-1512499617640-c74ae3a79d37?w=600&q=80',
    palette: ['#0f172a', '#3b82f6', '#f8fafc'],
    extracted_tags: ['subject', 'composition'],
    features: ['In-Browser', '4K Export', 'Device Frames'],
  },
  {
    id: 'dir-effect-app',
    title: 'effect.app',
    description: 'Live interactive photo and video shader effects in your browser. Apply halftones, chromatic aberration, dithering, and retro CRT scanlines instantly.',
    category: 'tools',
    branch: 'tools',
    sub_branch: 'Browser Shaders & FX',
    media_type: 'videos',
    item_kind: 'external_resource',
    source_name: 'effect.app',
    source_url: 'https://effect.app',
    search_url_template: 'https://www.google.com/search?q=site:effect.app+%s',
    media_url: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=600&q=80',
    palette: ['#000000', '#00ffcc', '#ff0055'],
    extracted_tags: ['texture', 'lighting', 'color'],
    features: ['Real-time WebGL', 'Video FX', 'CRT / Dither'],
  },
  {
    id: 'dir-spline',
    title: 'Spline 3D',
    description: 'Collaborative in-browser 3D design tool. Create 3D scenes, animate interactive models, and export lightweight embeds or visual reference stills.',
    category: 'tools',
    branch: 'tools',
    sub_branch: 'Interactive 3D',
    media_type: 'design',
    item_kind: 'external_resource',
    source_name: 'Spline',
    source_url: 'https://spline.design',
    search_url_template: 'https://spline.design/search?q=%s',
    media_url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&q=80',
    palette: ['#09090b', '#8b5cf6', '#ec4899'],
    extracted_tags: ['lighting', 'texture', 'mood'],
    features: ['Real-time 3D', 'Physics', 'Web Embeds'],
  },
  {
    id: 'dir-shadertoy',
    title: 'ShaderToy',
    description: 'Over 50,000 live generative procedural GLSL shaders. Inspiring reference for creative coding, audio-reactive graphics, and procedural textures.',
    category: 'tools',
    branch: 'tools',
    sub_branch: 'Browser Shaders & FX',
    media_type: 'videos',
    item_kind: 'external_resource',
    source_name: 'ShaderToy',
    source_url: 'https://www.shadertoy.com',
    search_url_template: 'https://www.shadertoy.com/results?query=%s',
    media_url: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=600&q=80',
    palette: ['#030712', '#a855f7', '#06b6d4'],
    extracted_tags: ['lighting', 'texture', 'color'],
    features: ['GLSL Shaders', 'Audio Reactive', 'Procedural Math'],
  },
]

// ── Starter Board Templates (wired to existing fixtures) ──────────────────────

export const BOARD_TEMPLATES: ExploreItem[] = [
  {
    id: 'tpl-album-cover-night',
    title: 'Album Cover — Nocturnal R&B',
    description: 'Moody nocturnal album cover scene with neon reflections and heavy shadow contrasts.',
    category: 'cover_art',
    branch: 'cover_art',
    sub_branch: 'Album Covers',
    media_type: 'template',
    item_kind: 'board_template',
    template_slug: 'album-cover-night',
    media_url: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=600&q=80',
    source_name: 'Starter template',
    palette: ['#0d0d12', '#221e33', '#e040fb', '#00e5ff'],
    extracted_tags: ['mood', 'lighting', 'color'],
  },
  {
    id: 'tpl-cover-art-bright',
    title: 'Cover Art — Summer Pop',
    description: 'Playful cover-art scene for a summer pop release with high-saturation palette.',
    category: 'cover_art',
    branch: 'cover_art',
    sub_branch: 'Album Covers',
    media_type: 'template',
    item_kind: 'board_template',
    template_slug: 'cover-art-bright',
    media_url: 'https://images.unsplash.com/photo-1518998053901-5348d3961a04?w=600&q=80',
    source_name: 'Starter template',
    palette: ['#ffcc00', '#0099cc', '#ff4f79', '#ffffff'],
    extracted_tags: ['color', 'mood', 'composition', 'subject'],
  },
  {
    id: 'tpl-editorial-streetwear',
    title: 'Editorial Streetwear Lookbook',
    description: 'Editorial streetwear lookbook in an abandoned tennis court with concrete and earth tones.',
    category: 'design_editorial',
    branch: 'design_editorial',
    sub_branch: 'Editorial Layouts',
    media_type: 'template',
    item_kind: 'board_template',
    template_slug: 'editorial-streetwear',
    media_url: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=600&q=80',
    source_name: 'Starter template',
    palette: ['#111827', '#f97316', '#f8fafc'],
    extracted_tags: ['composition', 'mood', 'lighting', 'texture', 'subject'],
  },
  {
    id: 'tpl-styling-texture',
    title: 'Monochrome Accessories — Texture',
    description: 'Tactile styling reference for a monochrome accessories shoot focusing on matte and gloss.',
    category: 'photography',
    branch: 'photography',
    sub_branch: '35mm Analog & Grain',
    media_type: 'template',
    item_kind: 'board_template',
    template_slug: 'styling-texture',
    media_url: 'https://images.unsplash.com/photo-1509319117193-57bab727e09d?w=600&q=80',
    source_name: 'Starter template',
    palette: ['#18181b', '#71717a', '#f4f4f5'],
    extracted_tags: ['texture', 'lighting', 'subject', 'composition'],
  },
]

// ── Curated Canvas Assets ────────────────────────────────────────────────────

export const CANVAS_ASSETS: ExploreItem[] = [
  {
    id: 'asset-neon-city',
    title: 'Neon City Night',
    description: 'Nocturnal cinematic still with rain reflections, neon teal and magenta lighting.',
    category: 'video_clips',
    branch: 'video_clips',
    sub_branch: 'Film Keyframes',
    media_type: 'images',
    item_kind: 'canvas_asset',
    source_name: 'Unsplash',
    source_url: 'https://unsplash.com',
    media_url: 'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?w=600&q=80',
    palette: ['#0f051d', '#00ffcc', '#ff007f'],
    extracted_tags: ['lighting', 'color', 'mood'],
  },
  {
    id: 'asset-golden-hour',
    title: 'Golden Hour Portrait',
    description: 'Warm low-angle sun with soft rim light and rich skin tones.',
    category: 'photography',
    branch: 'photography',
    sub_branch: 'Cinematic Lighting',
    media_type: 'images',
    item_kind: 'canvas_asset',
    source_name: 'Unsplash',
    source_url: 'https://unsplash.com',
    media_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=600&q=80',
    palette: ['#ff8c42', '#2c5d63', '#1e2022'],
    extracted_tags: ['lighting', 'color', 'subject'],
  },
  {
    id: 'asset-editorial-split',
    title: 'Editorial Split-Screen',
    description: 'Magazine-style split composition with bold negative space and high-contrast typography.',
    category: 'design_editorial',
    branch: 'design_editorial',
    sub_branch: 'Editorial Layouts',
    media_type: 'design',
    item_kind: 'canvas_asset',
    source_name: 'Unsplash',
    source_url: 'https://unsplash.com',
    media_url: 'https://images.unsplash.com/photo-1586717791821-3f44a563fa4c?w=600&q=80',
    palette: ['#ffffff', '#0f172a', '#ef4444'],
    extracted_tags: ['composition', 'subject'],
  },
  {
    id: 'asset-zine-collage',
    title: 'Zine Collage Cut-ups',
    description: 'DIY zine-style collage with torn paper edges, risograph textures, and tape.',
    category: 'design_editorial',
    branch: 'design_editorial',
    sub_branch: 'Zines & Collages',
    media_type: 'design',
    item_kind: 'canvas_asset',
    source_name: 'Unsplash',
    source_url: 'https://unsplash.com',
    media_url: 'https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=600&q=80',
    palette: ['#f5f0e1', '#d35400', '#2c3e50', '#ecf0f1'],
    extracted_tags: ['texture', 'composition', 'mood'],
  },
  {
    id: 'asset-type-gothic',
    title: 'Blackletter Gothic',
    description: 'Display blackletter specimen. Works for album art and heavy editorial headers.',
    category: 'fonts',
    branch: 'fonts',
    sub_branch: 'Free Display Type',
    media_type: 'fonts',
    item_kind: 'canvas_asset',
    source_name: 'Specimen',
    media_url: 'https://images.unsplash.com/photo-1455659817273-f96807779a8a?w=600&q=80',
    palette: ['#0a0a0a', '#d4a574', '#f5f0e1'],
    extracted_tags: ['mood', 'texture'],
    font_config: { family: 'UnifrakturMaguntia', weight: 400, notes: 'Blackletter / fraktur display' },
  },
  {
    id: 'asset-type-condensed',
    title: 'Ultra Condensed Grotesk',
    description: 'Tight-set compressed sans for sporty/editorial vibes and loud magazine covers.',
    category: 'fonts',
    branch: 'fonts',
    sub_branch: 'Free Display Type',
    media_type: 'fonts',
    item_kind: 'canvas_asset',
    source_name: 'Specimen',
    media_url: 'https://images.unsplash.com/photo-1524661135-423995f22d0b?w=600&q=80',
    palette: ['#111827', '#f8fafc'],
    extracted_tags: ['composition'],
    font_config: { family: 'Anton', weight: 400, style: 'normal', notes: 'Condensed grotesk / wide tracking' },
  },
  {
    id: 'asset-raw-concrete',
    title: 'Raw Concrete Texture',
    description: 'Poured architectural concrete texture with formwork lines and aggregate pores.',
    category: 'photography',
    branch: 'photography',
    sub_branch: '35mm Analog & Grain',
    media_type: 'images',
    item_kind: 'canvas_asset',
    source_name: 'Unsplash',
    source_url: 'https://unsplash.com',
    media_url: 'https://images.unsplash.com/photo-1518384401463-d3876163c195?w=600&q=80',
    palette: ['#475569', '#94a3b8', '#cbd5e1'],
    extracted_tags: ['texture', 'lighting'],
  },
  {
    id: 'asset-film-grain',
    title: 'Film Grain Overlay',
    description: 'Subtle 35mm photographic film grain texture to add tactile analog warmth.',
    category: 'photography',
    branch: 'photography',
    sub_branch: '35mm Analog & Grain',
    media_type: 'images',
    item_kind: 'canvas_asset',
    source_name: 'Unsplash',
    source_url: 'https://unsplash.com',
    media_url: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=600&q=80',
    palette: ['#1c1917', '#78716c', '#e7e5e4'],
    extracted_tags: ['texture', 'mood'],
  },
]

// ── Combined Catalog ─────────────────────────────────────────────────────────

export const EXPLORE_CATALOG: ExploreItem[] = [
  ...CREATIVE_DIRECTORY,
  ...BOARD_TEMPLATES,
  ...CANVAS_ASSETS,
]

// ── Vibe Query Adaptation (Option A vs Option B) ─────────────────────────────

export type VibeSearchMode = 'option_a' | 'option_b'

export function adaptQueryForBranch(query: string, branch: DirectoryBranchId, mode: VibeSearchMode): string {
  const trimmed = query.trim()
  if (!trimmed) return ''
  if (mode === 'option_a') {
    // Option A: Direct Deep-Link Search (raw verbatim query)
    return trimmed
  }

  // Option B: AI / Vibe Query Adaptation tailored to each specific discipline
  const lower = trimmed.toLowerCase()
  switch (branch) {
    case 'video_clips': {
      // Focus on motion, cinematic atmosphere, scene framing
      const videoKeywords = ['video', 'motion', 'cinematic', 'footage', 'scene', 'clip']
      const hasVideo = videoKeywords.some((k) => lower.includes(k))
      return hasVideo ? trimmed : `${trimmed} cinematic motion`
    }
    case 'cover_art': {
      // Focus on album cover design, music packaging, magazine covers
      const coverKeywords = ['cover', 'album', 'vinyl', 'poster', 'packaging', 'sleeve']
      const hasCover = coverKeywords.some((k) => lower.includes(k))
      return hasCover ? trimmed : `${trimmed} album cover art`
    }
    case 'design_editorial': {
      // Focus on editorial layout, graphic design, brutalist, grid
      const designKeywords = ['editorial', 'layout', 'design', 'poster', 'identity', 'zine']
      const hasDesign = designKeywords.some((k) => lower.includes(k))
      return hasDesign ? trimmed : `${trimmed} graphic design editorial`
    }
    case 'photography': {
      // Focus on cinematography, stills, 35mm, portrait, lighting
      const photoKeywords = ['photo', 'still', 'lighting', 'portrait', '35mm', 'analog']
      const hasPhoto = photoKeywords.some((k) => lower.includes(k))
      return hasPhoto ? trimmed : `${trimmed} 35mm cinematic still`
    }
    case 'fonts': {
      // Focus on typeface, font style, display, serif, sans
      const fontKeywords = ['font', 'type', 'typeface', 'display', 'serif', 'sans', 'grotesk']
      const hasFont = fontKeywords.some((k) => lower.includes(k))
      return hasFont ? trimmed : `${trimmed} display typeface`
    }
    case 'color_codes': {
      // Focus on color palette, hex, gradient, tones
      const colorKeywords = ['color', 'palette', 'hex', 'gradient', 'tones', 'shades']
      const hasColor = colorKeywords.some((k) => lower.includes(k))
      return hasColor ? trimmed : `${trimmed} color palette`
    }
    case 'tools': {
      // Focus on mockup, shader, 3D tool
      return `${trimmed} mockup generator`
    }
    default:
      return trimmed
  }
}

export function buildDirectSearchUrl(item: ExploreItem, query: string, mode: VibeSearchMode = 'option_a'): string {
  const adapted = adaptQueryForBranch(query, item.branch, mode)
  if (!item.search_url_template) {
    if (item.source_url) {
      return `${item.source_url}?q=${encodeURIComponent(adapted)}`
    }
    return `https://www.google.com/search?q=${encodeURIComponent(adapted)}`
  }

  const encoded = encodeURIComponent(adapted)
  return item.search_url_template.replace('%s', encoded)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function filterCatalog(options: {
  branch?: DirectoryBranchId
  subBranch?: string
  category?: ExploreCategory
  mediaType?: ExploreMediaFilter
  query?: string
  q?: string
  tag?: Tag
}): ExploreItem[] {
  let items = EXPLORE_CATALOG

  // Filter by primary directory branch or legacy category
  if (options.branch && options.branch !== 'all') {
    items = items.filter((item) => item.branch === options.branch || item.category === options.branch)
  } else if (options.category) {
    items = items.filter(
      (item) => item.category === options.category || item.branch === options.category
    )
  }

  // Filter by sub-branch (leaf)
  if (options.subBranch && options.subBranch !== 'all') {
    items = items.filter((item) => item.sub_branch === options.subBranch)
  }

  // Filter by media type
  if (options.mediaType && options.mediaType !== 'all') {
    items = items.filter((item) => item.media_type === options.mediaType)
  }

  // Filter by search query
  const rawQuery = options.query ?? options.q
  if (rawQuery) {
    const q = rawQuery.toLowerCase()
    items = items.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.description?.toLowerCase().includes(q) ||
        item.source_name?.toLowerCase().includes(q) ||
        item.sub_branch?.toLowerCase().includes(q) ||
        item.features?.some((f) => f.toLowerCase().includes(q)) ||
        item.extracted_tags.some((t) => t.toLowerCase().includes(q))
    )
  }

  // Filter by tag
  if (options.tag) {
    items = items.filter((item) => item.extracted_tags.includes(options.tag!))
  }

  return items
}

export function getBranchItemCount(branchId: DirectoryBranchId): number {
  if (branchId === 'all') return EXPLORE_CATALOG.length
  return EXPLORE_CATALOG.filter((item) => item.branch === branchId || item.category === branchId).length
}
