import type { LessonId, PageId } from "./lessons";

/**
 * Where each lesson's claims come from, shown after its last step in both
 * its full and short versions, in two groups:
 *
 * - `start`: plain-language explainers, mostly visual or interactive, for a
 *   reader meeting the idea for the first time.
 * - `papers`: the papers behind the methods, the standards behind the
 *   numbers, and the libraries the gallery runs.
 *
 * Each `note` says what the source is good for, so a reader can tell which
 * to open. Every link was checked when it was added.
 */
export interface Source {
  /** Who and when, as it's cited: "Zhai et al. (2023)". */
  cite: string;
  title: string;
  /** Journal, conference, publisher or site, with volume and pages where there are any. */
  venue: string;
  url: string;
  note: string;
}

export interface LessonSourceList {
  start: Source[];
  papers: Source[];
}

/** The two groups, in page order. Their ids double as the rail's anchors. */
export const SOURCE_GROUPS = [
  { key: "start", id: "sources-start", title: "Start here", short: "Start here" },
  { key: "papers", id: "sources-papers", title: "Papers & references", short: "Papers" },
] as const satisfies readonly { key: keyof LessonSourceList; id: string; title: string; short: string }[];

const ARXIV = (id: string) => `https://arxiv.org/abs/${id}`;
const DOI = (id: string) => `https://doi.org/${id}`;

// Shared between lessons.

const VIT: Source = {
  cite: "Dosovitskiy et al. (2021)",
  title: "An Image Is Worth 16x16 Words: Transformers for Image Recognition at Scale",
  venue: "ICLR 2021",
  url: ARXIV("2010.11929"),
  note: "Reading an image as a grid of patches, the way a language model reads words.",
};

const REGISTERS: Source = {
  cite: "Darcet, Oquab, Mairal & Bojanowski (2024)",
  title: "Vision Transformers Need Registers",
  venue: "ICLR 2024",
  url: ARXIV("2309.16588"),
  note: "Why a transformer turns some patches into scratch space, and the spare register tokens added to hold it instead.",
};

const NEURAL_NETWORKS: Source = {
  cite: "Sanderson (2017)",
  title: "But what is a Neural Network?",
  venue: "3Blue1Brown, Deep Learning chapter 1 (video and text)",
  url: "https://www.3blue1brown.com/lessons/neural-networks",
  note: "What a neural network is and what its layers do, built up from scratch with pictures. No background needed.",
};

const ILLUSTRATED_TRANSFORMER: Source = {
  cite: "Alammar (2018)",
  title: "The Illustrated Transformer",
  venue: "jalammar.github.io",
  url: "https://jalammar.github.io/illustrated-transformer/",
  note: "Attention drawn out step by step, for words rather than patches, but the mechanism is the same.",
};

export const SOURCES: Record<LessonId, LessonSourceList> = {
  color: {
    start: [
      {
        cite: "Verou (2020)",
        title: "LCH colors in CSS: what, why, and how?",
        venue: "lea.verou.me",
        url: "https://lea.verou.me/blog/2020/04/lch-colors-in-css-what-why-and-how/",
        note: "Why RGB numbers don't match what the eye sees, and CIELAB's lightness, chroma and hue angle, with color examples. Written for web designers; no math needed.",
      },
      {
        cite: "Ciechanowski (2019)",
        title: "Color Spaces",
        venue: "ciechanow.ski",
        url: "https://ciechanow.ski/color-spaces/",
        note: "An interactive tour of how screens make color and how color spaces describe it. The early sections are gentle; it gets mathematical later on.",
      },
      {
        cite: "Harris (2014)",
        title: "Visualizing K-Means Clustering",
        venue: "naftaliharris.com",
        url: "https://www.naftaliharris.com/blog/visualizing-k-means-clustering/",
        note: "Step through k-means yourself on dots you place, the same clustering that finds each panel's dominant colors.",
      },
    ],
    papers: [
      {
        cite: "CIE (2018)",
        title: "Colorimetry, 4th edition (CIE 015:2018)",
        venue: "International Commission on Illumination",
        url: DOI("10.25039/TR.015.2018"),
        note: "The standard that defines CIELAB's L*, a* and b*, and the straight-line ΔE distance.",
      },
      {
        cite: "Mahy, Van Eycken & Oosterlinck (1994)",
        title: "Evaluation of Uniform Color Spaces Developed after the Adoption of CIELAB and CIELUV",
        venue: "Color Research & Application 19(2), 105–121",
        url: DOI("10.1111/j.1520-6378.1994.tb00070.x"),
        note: "The source of the often-quoted figure that a CIELAB distance of about 2.3 is just noticeable.",
      },
      {
        cite: "Sharma, Wu & Dalal (2005)",
        title: "The CIEDE2000 Color-Difference Formula: Implementation Notes, Supplementary Test Data, and Mathematical Observations",
        venue: "Color Research & Application 30(1), 21–30",
        url: DOI("10.1002/col.20070"),
        note: "Why CIELAB is only roughly even: the corrections a later distance formula makes, including for blues.",
      },
      {
        cite: "Ottosson (2020)",
        title: "A perceptual color space for image processing",
        venue: "bottosson.github.io",
        url: "https://bottosson.github.io/posts/oklab/",
        note: "OKLab, the color space the chroma share and key color are measured in.",
      },
      {
        cite: "Lloyd (1982)",
        title: "Least Squares Quantization in PCM",
        venue: "IEEE Transactions on Information Theory 28(2), 129–137",
        url: DOI("10.1109/TIT.1982.1056489"),
        note: "The k-means clustering that finds each panel's three dominant colors.",
      },
    ],
  },

  phash: {
    start: [
      {
        cite: "Krawetz (2011)",
        title: "Looks Like It",
        venue: "The Hacker Factor Blog, 26 May 2011",
        url: "https://www.hackerfactor.com/blog/index.php?/archives/432-Looks-Like-It.html",
        note: "The recipe this lesson follows, in a short plain blog post: shrink to 32 × 32, drop color, take the DCT, keep the top-left 8 × 8. It splits the bits at the mean; the imagehash library the gallery uses splits at the median.",
      },
      {
        cite: "Shehata (2019)",
        title: "Unraveling the JPEG",
        venue: "Parametric Press, issue 1",
        url: "https://parametric.press/issue-01/unraveling-the-jpeg/",
        note: "An interactive look inside a JPEG. Its middle section shows how any 8 × 8 block is a mix of 64 cosine patterns: the same patterns pHash keeps.",
      },
      {
        cite: "Weitz",
        title: "Discrete Cosine Transform",
        venue: "weitz.de",
        url: "https://www.weitz.de/dct/",
        note: "Builds the DCT up from a few sampled cosine waves, with interactive grids and no derivations.",
      },
    ],
    papers: [
      {
        cite: "Zauner (2010)",
        title: "Implementation and Benchmarking of Perceptual Image Hash Functions",
        venue: "Master's thesis, Upper Austria University of Applied Sciences, Hagenberg",
        url: "https://phash.org/docs/pubs/thesis_zauner.pdf",
        note: "How the DCT-based hash holds up against resizing, compression and other edits, beside other perceptual hashes.",
      },
      {
        cite: "Buchner",
        title: "ImageHash: a Python perceptual image hashing module",
        venue: "GitHub",
        url: "https://github.com/JohannesBuchner/imagehash",
        note: "The library that computes every panel's hash.",
      },
      {
        cite: "Ahmed, Natarajan & Rao (1974)",
        title: "Discrete Cosine Transform",
        venue: "IEEE Transactions on Computers C-23(1), 90–93",
        url: DOI("10.1109/T-C.1974.223784"),
        note: "The paper that introduced the DCT.",
      },
      {
        cite: "ITU-R (2011)",
        title: "Recommendation BT.601: Studio encoding parameters of digital television for standard 4:3 and wide-screen 16:9 aspect ratios",
        venue: "International Telecommunication Union",
        url: "https://www.itu.int/rec/R-REC-BT.601",
        note: "Where the 0.299, 0.587 and 0.114 luma weights come from; Pillow's grayscale conversion uses them.",
      },
      {
        cite: "Hamming (1950)",
        title: "Error Detecting and Error Correcting Codes",
        venue: "Bell System Technical Journal 29(2), 147–160",
        url: DOI("10.1002/j.1538-7305.1950.tb00463.x"),
        note: "The paper the Hamming distance is named after.",
      },
    ],
  },

  vectors: {
    start: [
      {
        cite: "Sanderson (2016)",
        title: "Vectors, what even are they?",
        venue: "3Blue1Brown, Essence of Linear Algebra chapter 1 (video and text)",
        url: "https://www.3blue1brown.com/lessons/vectors",
        note: "A list of numbers as an arrow, the starting idea of this lesson, drawn out from scratch.",
      },
      {
        cite: "Alammar (2019)",
        title: "The Illustrated Word2vec",
        venue: "jalammar.github.io",
        url: "https://jalammar.github.io/illustrated-word2vec/",
        note: "Embeddings and cosine similarity explained with pictures, using people and words instead of panels. The later training sections are more technical.",
      },
      {
        cite: "Sanderson (2016)",
        title: "Dot products and duality",
        venue: "3Blue1Brown, Essence of Linear Algebra chapter 9 (video and text)",
        url: "https://www.3blue1brown.com/lessons/dot-products",
        note: "Why multiplying and adding matching numbers measures how much two arrows line up. The first half stands on its own; the second builds on earlier chapters.",
      },
    ],
    papers: [
      {
        cite: "Manning, Raghavan & Schütze (2008)",
        title: "Introduction to Information Retrieval, §6.3.1: Dot products",
        venue: "Cambridge University Press (free online edition)",
        url: "https://nlp.stanford.edu/IR-book/html/htmledition/dot-products-1.html",
        note: "A textbook walk-through of cosine similarity, and why normalized vectors reduce it to a dot product.",
      },
      {
        cite: "Salton, Wong & Yang (1975)",
        title: "A Vector Space Model for Automatic Indexing",
        venue: "Communications of the ACM 18(11), 613–620",
        url: DOI("10.1145/361219.361220"),
        note: "The early, influential case for comparing things as vectors by the angle between them.",
      },
    ],
  },

  siglip: {
    start: [
      NEURAL_NETWORKS,
      ILLUSTRATED_TRANSFORMER,
      {
        cite: "Sanderson (2024)",
        title: "Attention in transformers, step-by-step",
        venue: "3Blue1Brown, Deep Learning chapter 6 (video and text)",
        url: "https://www.3blue1brown.com/lessons/attention",
        note: "A careful visual walk through attention. It assumes the series' earlier chapters, so watch those first if it moves too fast.",
      },
      {
        cite: "Radford et al. (2021)",
        title: "CLIP: Connecting text and images",
        venue: "OpenAI",
        url: "https://openai.com/index/clip/",
        note: "The announcement of CLIP, the image-and-caption training SigLIP refines. The opening explains the idea plainly; the rest is results.",
      },
    ],
    papers: [
      {
        cite: "Zhai, Mustafa, Kolesnikov & Beyer (2023)",
        title: "Sigmoid Loss for Language Image Pre-Training",
        venue: "ICCV 2023",
        url: ARXIV("2303.15343"),
        note: "The SigLIP paper: how the model was trained on images and their captions.",
      },
      {
        cite: "Radford et al. (2021)",
        title: "Learning Transferable Visual Models From Natural Language Supervision",
        venue: "ICML 2021",
        url: ARXIV("2103.00020"),
        note: "The CLIP paper.",
      },
      VIT,
      {
        cite: "Vaswani et al. (2017)",
        title: "Attention Is All You Need",
        venue: "NeurIPS 2017",
        url: ARXIV("1706.03762"),
        note: "The transformer, and the attention step its layers repeat.",
      },
      {
        cite: "Zhai, Kolesnikov, Houlsby & Beyer (2022)",
        title: "Scaling Vision Transformers",
        venue: "CVPR 2022",
        url: ARXIV("2106.04560"),
        note: "The attention-pooling head (one learned question over every patch) that SigLIP ends with.",
      },
      REGISTERS,
      {
        cite: "Google",
        title: "google/siglip-base-patch16-224",
        venue: "Hugging Face model card",
        url: "https://huggingface.co/google/siglip-base-patch16-224",
        note: "The exact model the gallery runs: 224 × 224 input, 16-pixel patches, 768 numbers out.",
      },
    ],
  },

  dino: {
    start: [
      {
        cite: "The DINOv2 team (2023)",
        title: "DINOv2: State-of-the-art computer vision models with self-supervised learning",
        venue: "Meta AI blog",
        url: "https://ai.meta.com/blog/dino-v2-computer-vision-self-supervised-learning/",
        note: "The release post: what learning from pictures alone means and why it was worth doing, in plain prose.",
      },
      ILLUSTRATED_TRANSFORMER,
      NEURAL_NETWORKS,
    ],
    papers: [
      {
        cite: "Oquab et al. (2024)",
        title: "DINOv2: Learning Robust Visual Features without Supervision",
        venue: "Transactions on Machine Learning Research",
        url: ARXIV("2304.07193"),
        note: "The DINOv2 paper: how it learned from pictures alone.",
      },
      {
        cite: "Caron et al. (2021)",
        title: "Emerging Properties in Self-Supervised Vision Transformers",
        venue: "ICCV 2021",
        url: ARXIV("2104.14294"),
        note: "DINO, the self-supervised method DINOv2 builds on, and what its CLS token learns to attend to.",
      },
      REGISTERS,
      VIT,
      {
        cite: "Meta AI",
        title: "facebook/dinov2-with-registers-small",
        venue: "Hugging Face model card",
        url: "https://huggingface.co/facebook/dinov2-with-registers-small",
        note: "The exact model the gallery runs: 14-pixel patches, 384 numbers per token, with registers.",
      },
    ],
  },

  gram: {
    start: [
      {
        cite: "Wang et al. (2020)",
        title: "CNN Explainer",
        venue: "Polo Club of Data Science, Georgia Tech (interactive)",
        url: "https://poloclub.github.io/cnn-explainer/",
        note: "Click through a small convolutional network and watch its filters slide over an image, the same kind of layers VGG-16 stacks.",
      },
      {
        cite: "Olah, Mordvintsev & Schubert (2017)",
        title: "Feature Visualization",
        venue: "Distill",
        url: "https://distill.pub/2017/feature-visualization/",
        note: "Pictures of what individual filters respond to, from fine textures in early layers to whole objects later. Skim the images; the text goes deeper.",
      },
      {
        cite: "Powell & Lehe",
        title: "Principal Component Analysis, Explained Visually",
        venue: "Setosa",
        url: "https://setosa.io/ev/principal-component-analysis/",
        note: "Drag points around and watch PCA find the directions they spread along most, as it does with the Gram numbers.",
      },
      {
        cite: "TensorFlow",
        title: "Neural style transfer",
        venue: "TensorFlow tutorials",
        url: "https://www.tensorflow.org/tutorials/generative/style_transfer",
        note: "Gram matrices used to copy one picture's style onto another. Code-first, but the before-and-after images make the idea clear.",
      },
    ],
    papers: [
      {
        cite: "Simonyan & Zisserman (2015)",
        title: "Very Deep Convolutional Networks for Large-Scale Image Recognition",
        venue: "ICLR 2015",
        url: ARXIV("1409.1556"),
        note: "The VGG-16 network whose filters the Gram model reads.",
      },
      {
        cite: "Gatys, Ecker & Bethge (2015)",
        title: "Texture Synthesis Using Convolutional Neural Networks",
        venue: "NeurIPS 2015",
        url: ARXIV("1505.07376"),
        note: "Gram matrices of VGG's filter responses as a description of texture, with layout thrown away.",
      },
      {
        cite: "Gatys, Ecker & Bethge (2015)",
        title: "A Neural Algorithm of Artistic Style",
        venue: "arXiv preprint",
        url: ARXIV("1508.06576"),
        note: "The same Gram matrices used to separate an image's style from its content.",
      },
      {
        cite: "Deng et al. (2009)",
        title: "ImageNet: A Large-Scale Hierarchical Image Database",
        venue: "CVPR 2009",
        url: DOI("10.1109/CVPR.2009.5206848"),
        note: "The labelled photos VGG-16 was trained on.",
      },
      {
        cite: "Jolliffe & Cadima (2016)",
        title: "Principal Component Analysis: A Review and Recent Developments",
        venue: "Philosophical Transactions of the Royal Society A 374(2065), 20150202",
        url: DOI("10.1098/rsta.2015.0202"),
        note: "An open-access review of PCA, which compresses the raw Gram numbers to 30.",
      },
    ],
  },
};

/** A lesson's sources, or null for pages without any (the overview, the glossary). */
export function sourcesFor(page: PageId): LessonSourceList | null {
  return page in SOURCES ? SOURCES[page as LessonId] : null;
}

/** Whether a step id names one of the source groups rather than a lesson step. */
export function isSourceStep(step: string | null | undefined): boolean {
  return SOURCE_GROUPS.some((g) => g.id === step);
}
