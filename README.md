For my final project, I built a Taxi Live Statistics dashboard on top of a Spark-based
streaming pipeline. The pipeline ingests taxi trip events, aggregates them into 10-minute
windows using Spark Streaming, exports the aggregated data to CSV, and serves it through a
Node.js web application running on an EC2 instance. The frontend (taxi.html) visualizes
the resulting 50k+ trips with several high-level insights: busiest hour-of-day, day vs night 
traffic, weekday vs weekend patterns, and the distribution of traffic across the 
top 5 peak windows.

Architecturally, the system follows the same lambda-style pattern as the in-class 
flight-delay example (batch + speed + serving layers), but the implementation and user-facing UI are 
entirely disjoint and focused solely on taxi data.

Repository structure & file-by-file description

Below is a complete breakdown of the project repository and each component’s role within
the full lambda-style architecture.

## Repository Structure

### **app.js**
- Node.js Express server that powers the serving layer.
- Hosts static frontend files from the `public/` directory.
- Exposes a custom API endpoint:
  - `GET /api/taxi/live_stats` – loads and parses `data/taxi_live_stats.csv`, returning JSON.
- Includes HBase client setup from the class demo (unused for this project but left intact).
- Runs on port `3012` when deployed on the EC2 web server.

### **public/taxi.html**
- Main frontend dashboard for the Taxi Live Statistics project.
- Fetches aggregated taxi data from `/api/taxi/live_stats`.
- Computes:
  - Total trips
  - Busiest hour-of-day (+ share of total traffic)
  - Day vs night splits
  - Weekday vs weekend splits
  - Top 5 busiest 10-minute windows
- Renders:
  - Key Insights (bulleted, bold)
  - Hour-of-day and day-of-week bar charts (Chart.js)
  - Top 5 busiest windows table
  - Sample of 10-minute windows table

### **public/index.html**, **public/delays.html**, **public/submit-weather.html**
- Part of the original in-class flight/weather demo.
- Do not interact with or affect the taxi project.
- Included only because they are part of the base repository.

### **data/taxi_live_stats.csv**
- Output snapshot from Spark Streaming.
- Produced by consuming taxi trip events and aggregating into 10‑minute windows.
- Schema:
  - `window_start`
  - `window_end`
  - `count`
  - `metric1`
  - `metric2`

### **spark/** (Cluster-side code, not on EC2)
- Contains the Spark Structured Streaming job:
  - Reads raw taxi events from Kafka.
  - Cleans and filters records.
  - Aggregates events using tumbling window logic (`groupBy(window(...))`).
  - Writes output to HDFS, then exported to CSV.

### **package.json** / **package-lock.json**
- Node.js dependency definitions.
- Used for Express server, HBase client, etc.

### **node_modules/**
- Auto-generated dependency folder. Not manually edited.

## Running the Application

### 1. Start the Node.js Serving Layer (on EC2)
```bash
ssh -i ~/.ssh/id_rsa ec2-user@ec2-52-20-203-80.compute-1.amazonaws.com
cd /home/ec2-user/egrantcharov
node app.js 3012 http://ec2-44-201-161-20.compute-1.amazonaws.com:8070/
```
- This launches the web server at  
  `http://ec2-52-20-203-80.compute-1.amazonaws.com:3012/taxi.html

## Spark Streaming Job (Cluster)

- Run on Hadoop cluster:
  ```bash
  spark-submit \
    --class TaxiStreamingJob \
    --master yarn \
    --deploy-mode client \
    taxi-streaming.jar \
    --output /home/hadoop/live_stats_export/
  ```
- Produces the exported `taxi_live_stats.csv`.

### Stopping Streaming Jobs
```bash
yarn application -list
yarn application -kill <application_id>
```

## Deploying New Frontend Updates
```bash
scp -i ~/.ssh/id_rsa public/taxi.html \
  ec2-user@ec2-52-20-203-80.compute-1.amazonaws.com:/home/ec2-user/egrantcharov/public/taxi.html
  ```

After upload, refresh the browser; Node server does not need restart for static file changes.