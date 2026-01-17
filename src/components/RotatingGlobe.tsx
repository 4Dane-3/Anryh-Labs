"use client"

import { useEffect, useRef, useState } from "react"
import * as d3 from "d3"
import { feature } from "topojson-client"

interface GeoFeature {
  type: string
  geometry: any
  properties: any
}

// City locations [longitude, latitude]
const cities = [
  { name: "Seattle", coords: [-122.3321, 47.6062] },
  { name: "San Francisco", coords: [-122.4194, 37.7749] },
  { name: "Manila", coords: [120.9842, 14.5995] },
]

export function RotatingGlobe() {
  const svgRef = useRef<SVGSVGElement>(null)
  const [worldData, setWorldData] = useState<GeoFeature[]>([])
  const rotationRef = useRef(0)
  const animationRef = useRef<number | undefined>(undefined)

  const width = 500
  const height = 500

  // Load world data
  useEffect(() => {
    const loadWorldData = async () => {
      try {
        const response = await fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json")
        const world: any = await response.json()
        const countries = (feature(world, world.objects.countries) as any).features
        setWorldData(countries)
      } catch (error) {
        console.log("Error loading world data:", error)
      }
    }

    loadWorldData()
  }, [])

  // Continuous rotation animation
  useEffect(() => {
    if (!svgRef.current || worldData.length === 0) return

    const renderGlobe = () => {
      const svg = d3.select(svgRef.current)
      svg.selectAll("*").remove()

      const projection = d3.geoOrthographic()
        .scale(200)
        .translate([width / 2, height / 2])
        .rotate([rotationRef.current, -20])
        .precision(0.1)

      const path = d3.geoPath(projection)

      // Add graticule (grid lines)
      try {
        const graticule = d3.geoGraticule()
        const graticulePath = path(graticule())
        if (graticulePath) {
          svg
            .append("path")
            .datum(graticule())
            .attr("d", graticulePath)
            .attr("fill", "none")
            .attr("stroke", "#f97316")
            .attr("stroke-width", 0.3)
            .attr("opacity", 0.25)
        }
      } catch (error) {}

      // Add countries
      svg
        .selectAll(".country")
        .data(worldData)
        .enter()
        .append("path")
        .attr("class", "country")
        .attr("d", (d) => {
          try {
            const pathString = path(d as any)
            if (!pathString) return ""
            if (typeof pathString === "string" && (pathString.includes("NaN") || pathString.includes("Infinity"))) {
              return ""
            }
            return pathString
          } catch (error) {
            return ""
          }
        })
        .attr("fill", "none")
        .attr("stroke", "#f97316")
        .attr("stroke-width", 0.8)
        .attr("opacity", 0.7)
        .style("visibility", function () {
          const pathData = d3.select(this).attr("d")
          return pathData && pathData.length > 0 && !pathData.includes("NaN") ? "visible" : "hidden"
        })

      // Draw sphere outline
      try {
        const sphereOutline = path({ type: "Sphere" })
        if (sphereOutline) {
          svg
            .append("path")
            .datum({ type: "Sphere" })
            .attr("d", sphereOutline)
            .attr("fill", "none")
            .attr("stroke", "#f97316")
            .attr("stroke-width", 1.5)
            .attr("opacity", 0.5)
        }
      } catch (error) {}

      // Add pulsing dots for cities
      const defs = svg.append("defs")
      
      // Create pulsing animation filter
      cities.forEach((city, index) => {
        const projected = projection(city.coords as [number, number])
        
        if (projected) {
          // Check if the point is on the visible side of the globe
          const center = projection.rotate()
          const distance = d3.geoDistance(
            city.coords as [number, number],
            [-center[0], -center[1]]
          )
          
          // Only show if on visible hemisphere (distance < π/2)
          if (distance < Math.PI / 2) {
            const [x, y] = projected
            
            // Outer pulsing ring
            svg
              .append("circle")
              .attr("cx", x)
              .attr("cy", y)
              .attr("r", 12)
              .attr("fill", "none")
              .attr("stroke", "#ffffff")
              .attr("stroke-width", 2)
              .attr("opacity", 0.6)
              .style("animation", `pulse 2s ease-in-out infinite`)
              .style("animation-delay", `${index * 0.5}s`)
              .style("transform-origin", `${x}px ${y}px`)
            
            // Middle pulsing ring
            svg
              .append("circle")
              .attr("cx", x)
              .attr("cy", y)
              .attr("r", 8)
              .attr("fill", "none")
              .attr("stroke", "#ffffff")
              .attr("stroke-width", 1.5)
              .attr("opacity", 0.4)
              .style("animation", `pulse 2s ease-in-out infinite`)
              .style("animation-delay", `${index * 0.5 + 0.3}s`)
              .style("transform-origin", `${x}px ${y}px`)
            
            // Center dot
            svg
              .append("circle")
              .attr("cx", x)
              .attr("cy", y)
              .attr("r", 4)
              .attr("fill", "#ffffff")
              .attr("opacity", 1)
          }
        }
      })

      // Update rotation for next frame
      rotationRef.current += 0.15

      // Continue animation
      animationRef.current = requestAnimationFrame(renderGlobe)
    }

    renderGlobe()

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [worldData])

  return (
    <>
      <style jsx global>{`
        @keyframes pulse {
          0% {
            transform: scale(1);
            opacity: 0.6;
          }
          50% {
            transform: scale(1.5);
            opacity: 0.2;
          }
          100% {
            transform: scale(1);
            opacity: 0.6;
          }
        }
      `}</style>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-full"
        preserveAspectRatio="xMidYMid meet"
      />
    </>
  )
}
