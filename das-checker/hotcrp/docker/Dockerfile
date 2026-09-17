FROM node:22-bookworm-slim AS assets
WORKDIR /build/das-checker
COPY das-checker/package.json das-checker/package-lock.json ./
RUN npm ci --omit=dev

FROM php:8.3-apache-bookworm AS web
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates libicu-dev libonig-dev mariadb-client poppler-utils \
    && docker-php-ext-install mysqli intl mbstring \
    && a2enmod rewrite \
    && rm -rf /var/lib/apt/lists/*
ARG HOTCRP_COMMIT=71dac06a03ac57dc1578c315473f9c1e1a9897b2
# The PHP image's document root belongs to www-data; build-time Git runs as root.
RUN chown root:root /var/www/html \
    && git init /var/www/html && cd /var/www/html \
    && git remote add origin https://github.com/kohler/hotcrp.git \
    && git fetch --depth 1 origin "$HOTCRP_COMMIT" && git checkout --detach FETCH_HEAD
COPY das-checker/core.js /opt/das-checker/core.js
COPY das-checker/hotcrp/ /opt/das-checker/hotcrp/
COPY --from=assets /build/das-checker/node_modules/pdfjs-dist/build/ /opt/das-checker/node_modules/pdfjs-dist/build/
RUN bash /opt/das-checker/hotcrp/install.sh /var/www/html
COPY das-checker/hotcrp/docker/apache.conf /etc/apache2/sites-available/000-default.conf
COPY das-checker/hotcrp/docker/options.php /var/www/html/conf/options.php
RUN printf 'upload_max_filesize=100M\npost_max_size=110M\nmemory_limit=512M\nmax_input_vars=4096\nsession.gc_maxlifetime=86400\n' > /usr/local/etc/php/conf.d/hotcrp.ini
WORKDIR /var/www/html
ENTRYPOINT ["bash", "/opt/das-checker/hotcrp/docker/entrypoint.sh"]
CMD ["apache2-foreground"]

# All-in-one image for disposable local testing with docker run.
FROM web AS standalone
RUN apt-get update && apt-get install -y --no-install-recommends mariadb-server \
    && rm -rf /var/lib/apt/lists/* /var/lib/mysql/*
ENV DB_HOST=127.0.0.1 MYSQL_PWD=local-test-only
VOLUME /var/lib/mysql
ENTRYPOINT ["bash", "/opt/das-checker/hotcrp/docker/standalone.sh"]
CMD ["apache2-foreground"]
