FROM python:3.12-alpine
RUN adduser -D -u 10001 relay
USER relay
WORKDIR /srv
COPY app/ ./app/
ENV PORT=8080
EXPOSE 8080
CMD ["python", "app/main.py"]
