FROM python:3.12-slim
RUN useradd -u 10001 -m relay
USER relay
WORKDIR /srv
COPY app/ ./app/
ENV PORT=8080
EXPOSE 8080
CMD ["python", "app/main.py"]
