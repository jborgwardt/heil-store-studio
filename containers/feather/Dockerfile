FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg unzip xvfb x11vnc novnc python3-websockify openbox x11-utils libgl1 libegl1 libxkbcommon0 libxkbcommon-x11-0 libxcb-cursor0 libxcb-icccm4 libxcb-image0 libxcb-keysyms1 libxcb-render-util0 libxcb-xinerama0 libxcb-randr0 libxcb-shape0 libxcb-xfixes0 libdbus-1-3 fonts-dejavu-core tini && rm -rf /var/lib/apt/lists/*
COPY featherwallet.asc /tmp/featherwallet.asc
RUN set -eu; mkdir -p /opt/feather; cd /opt/feather; \
    curl -fL --retry 3 https://featherwallet.org/files/releases/linux/feather-2.9.1-linux.zip -o feather.zip; \
    curl -fL --retry 3 https://featherwallet.org/files/releases/hashes-2.9.1.txt -o hashes.txt; \
    gpg --batch --import /tmp/featherwallet.asc; \
    gpg --with-colons --fingerprint | grep -q '8185E158A33330C7FD61BC0D1F76E155CEFBA71C'; \
    gpg --batch --verify hashes.txt; \
    echo 'f1d40d619664d9e6318c086b9015ee72bc69741ec86148ce2ea2ef75ef47feed  feather.zip' | sha256sum -c -; \
    grep -q '^f1d40d619664d9e6318c086b9015ee72bc69741ec86148ce2ea2ef75ef47feed  feather-2.9.1-linux.zip' hashes.txt; \
    unzip feather.zip; rm feather.zip; mv feather-2.9.1 feather; chmod +x feather; \
    useradd -u 1000 -m -d /data feather
COPY start.sh /usr/local/bin/start-feather
COPY session.sh /usr/local/bin/feather-session
RUN chmod +x /usr/local/bin/start-feather /usr/local/bin/feather-session
ENV HOME=/data DISPLAY=:0 QT_X11_NO_MITSHM=1
EXPOSE 6080
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/start-feather"]
