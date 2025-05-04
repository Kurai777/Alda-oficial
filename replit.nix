{ pkgs }:
{
  deps = [
    pkgs.nodejs
    
    # Dependências completas para Puppeteer/Chromium no Nix (Restaurando)
    pkgs.chromium
    pkgs.alsa-lib
    pkgs.at-spi2-atk
    pkgs.at-spi2-core
    pkgs.atk
    pkgs.cairo
    pkgs.cups
    pkgs.dbus
    pkgs.expat
    pkgs.fontconfig
    pkgs.freetype
    pkgs.gdk-pixbuf
    pkgs.glib 
    pkgs.nspr
    pkgs.graphite2
    pkgs.gtk3
    pkgs.harfbuzz
    pkgs.libGL
    pkgs.libdatrie
    pkgs.libdrm
    # pkgs.libepoxy # Manter comentado por enquanto
    pkgs.libgcrypt
    pkgs.libthai
    pkgs.libxkbcommon
    pkgs.mesa
    pkgs.nss
    pkgs.pango
    pkgs.pipewire 
    pkgs.systemd 
    pkgs.xorg.libX11
    pkgs.xorg.libXScrnSaver
    pkgs.xorg.libXcomposite
    pkgs.xorg.libXcursor
    pkgs.xorg.libXdamage
    pkgs.xorg.libXext
    pkgs.xorg.libXfixes
    pkgs.xorg.libXi
    pkgs.xorg.libXrandr
    pkgs.xorg.libXrender
    pkgs.xorg.libXtst
    pkgs.xorg.libxcb
    pkgs.xorg.libxkbfile
    pkgs.xorg.libxshmfence
  ];
  env = {
     # Configurações para Puppeteer usar o Chromium do Nix (Restaurando)
     PUPPETEER_SKIP_CHROMIUM_DOWNLOAD = "true";
     PUPPETEER_EXECUTABLE_PATH = pkgs.lib.getBin pkgs.chromium;
     FONTCONFIG_PATH = "/etc/fonts";
   };
} 