{ pkgs }:
{
  deps = [
    pkgs.nodejs_20
    
    # Adicionar Ghostscript headless para processamento de PDF
    pkgs.ghostscript_headless 
    
    # Dependências completas para Puppeteer/Chromium no Nix (REMOVIDAS)
    # pkgs.chromium  // REMOVIDO
    # pkgs.alsa-lib // REMOVIDO
    # pkgs.at-spi2-atk // REMOVIDO
    # pkgs.at-spi2-core // REMOVIDO
    # pkgs.atk // REMOVIDO
    # pkgs.cairo // REMOVIDO
    # pkgs.cups // REMOVIDO
    # pkgs.dbus // REMOVIDO
    # pkgs.expat // REMOVIDO
    # pkgs.fontconfig // REMOVIDO
    # pkgs.freetype // REMOVIDO
    # pkgs.gdk-pixbuf // REMOVIDO
    # pkgs.glib  // REMOVIDO
    # pkgs.nspr // REMOVIDO
    # pkgs.graphite2 // REMOVIDO
    # pkgs.gtk3 // REMOVIDO
    # pkgs.harfbuzz // REMOVIDO
    # pkgs.libGL // REMOVIDO
    # pkgs.libdatrie // REMOVIDO
    # pkgs.libdrm // REMOVIDO
    # # pkgs.libepoxy # Manter comentado por enquanto // JÁ ESTAVA COMENTADO
    # pkgs.libgcrypt // REMOVIDO
    # pkgs.libthai // REMOVIDO
    # pkgs.libxkbcommon // REMOVIDO
    # pkgs.mesa // REMOVIDO
    # pkgs.nss // REMOVIDO
    # pkgs.pango // REMOVIDO
    # pkgs.pipewire  // REMOVIDO
    # pkgs.systemd  // REMOVIDO
    # pkgs.xorg.libX11 // REMOVIDO
    # pkgs.xorg.libXScrnSaver // REMOVIDO
    # pkgs.xorg.libXcomposite // REMOVIDO
    # pkgs.xorg.libXcursor // REMOVIDO
    # pkgs.xorg.libXdamage // REMOVIDO
    # pkgs.xorg.libXext // REMOVIDO
    # pkgs.xorg.libXfixes // REMOVIDO
    # pkgs.xorg.libXi // REMOVIDO
    # pkgs.xorg.libXrandr // REMOVIDO
    # pkgs.xorg.libXrender // REMOVIDO
    # pkgs.xorg.libXtst // REMOVIDO
    # pkgs.xorg.libxcb // REMOVIDO
    # pkgs.xorg.libxkbfile // REMOVIDO
    # pkgs.xorg.libxshmfence // REMOVIDO
  ];
} 