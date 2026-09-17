import type { MetadataRoute } from "next";

type ManifestWithShareTarget = MetadataRoute.Manifest & {
  share_target: {
    action: string;
    method: "POST";
    enctype: "multipart/form-data";
    params: {
      title: string;
      text: string;
      url: string;
      files: Array<{ name: string; accept: string[] }>;
    };
  };
};

export default function manifest(): ManifestWithShareTarget {
  return {
    name: "ECO HOGAR",
    short_name: "ECO HOGAR",
    description: "Control privado de la economía familiar.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#e7ebf0",
    theme_color: "#0f172a",
    orientation: "portrait-primary",
    categories: ["finance", "productivity"],
    share_target: {
      action: "/compartir",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "title",
        text: "text",
        url: "url",
        files: [
          {
            name: "files",
            accept: [
              "image/*",
              "application/pdf",
              "application/octet-stream",
              ".jpg",
              ".jpeg",
              ".png",
              ".webp",
              ".heic",
              ".heif",
              ".pdf",
            ],
          },
        ],
      },
    },
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
